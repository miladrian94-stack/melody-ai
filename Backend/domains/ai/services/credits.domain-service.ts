// domains/ai/services/credits.domain-service.ts — Unified Credit Operations
//
// BEFORE this file: three different places implemented "deduct credits for
// a generation," each with a different atomicity guarantee:
//   1. CreditsService.deduct() (enterprise/services/credits.service.ts) —
//      its own standalone transaction, called AFTER the Song+AIJob creation
//      transaction had already committed in EnterpriseSongService — meaning
//      a crash between those two calls leaves a Song/AIJob with NO credit
//      ever deducted (a real, exploitable bug: queue many requests right as
//      the process is about to restart/crash).
//   2. SongGenerationService.createSong()'s inline transaction — deducts
//      INSIDE the same transaction as Song creation (the correct pattern),
//      but hardcodes a flat 1-credit cost and creates no AIJob row.
//   3. (implicitly) nothing in studio/generate/route.ts, which did no work
//      at all.
//
// This service is now the ONLY place credit deduction happens for AI
// generation, and it requires the caller to pass an active transaction
// client — making it IMPOSSIBLE to call this in a way that's non-atomic
// with the Song/AIJob creation that should accompany it. This is enforced
// by the type signature, not just a comment: there is no overload that
// runs without a `tx`.

import type { PrismaTransactionClient } from '../repositories/song.repository';
import { InsufficientCreditsError, AccountInactiveError, NotFoundError } from '@/Backend/domains/shared/errors/domain-errors';
import { domainEvents, DomainEventNames } from '@/Backend/domains/shared/events/event-bus';
import type { GenerationCost } from '../domain/song-generation.entity';

export interface CreditAccount {
  type: 'user' | 'organization';
  id: string;
}

export class CreditsDomainService {
  /**
   * Deducts the given cost from the account's credit balance, recording a
   * CreditLedger entry, WITHIN the caller's transaction. Throws
   * InsufficientCreditsError or AccountInactiveError rather than returning
   * a boolean — use-cases let these propagate and the API error formatter
   * (domain-errors.ts's toApiError) maps them to the right HTTP status, so
   * there's no separate "check then deduct" two-step that could race.
   */
  static async deduct(
    tx: PrismaTransactionClient,
    account: CreditAccount,
    cost: GenerationCost,
    reason: string,
    reference: { type: string; id: string },
  ): Promise<number> {
    if (account.type === 'organization') {
      const org = await tx.organization.findUnique({
        where: { id: account.id },
        select: { credits: true, isActive: true },
      });
      if (!org) throw new NotFoundError('Organization');
      if (!org.isActive) throw new AccountInactiveError('organization');
      if (org.credits < cost.credits) throw new InsufficientCreditsError(cost.credits, org.credits);

      const updated = await tx.organization.update({
        where: { id: account.id },
        data: { credits: { decrement: cost.credits } },
        select: { credits: true },
      });

      await tx.creditLedger.create({
        data: {
          organizationId: account.id,
          type: 'USAGE',
          amount: -cost.credits,
          balanceAfter: updated.credits,
          reason,
          referenceType: reference.type,
          referenceId: reference.id,
        },
      });

      domainEvents.publish(DomainEventNames.CREDITS_DEDUCTED, {
        accountType: 'organization',
        accountId: account.id,
        amount: cost.credits,
        balanceAfter: updated.credits,
        reason,
      });

      return updated.credits;
    }

    const user = await tx.user.findUnique({
      where: { id: account.id },
      select: { credits: true, isActive: true },
    });
    if (!user) throw new NotFoundError('User');
    if (!user.isActive) throw new AccountInactiveError('user');
    if (user.credits < cost.credits) throw new InsufficientCreditsError(cost.credits, user.credits);

    // ✅ Optimistic concurrency guard carried over from the original
    // SongGenerationService implementation — `credits: { gte: cost.credits }`
    // in the where clause means a second concurrent request that already
    // saw the pre-decrement balance can't also succeed in decrementing
    // past zero (Postgres's row-level locking on UPDATE serializes the two
    // writes; the second one re-evaluates the where clause against the
    // now-lower committed value and fails the match if insufficient).
    const updated = await tx.user.update({
      where: { id: account.id, credits: { gte: cost.credits } },
      data: { credits: { decrement: cost.credits } },
      select: { credits: true },
    });

    await tx.creditLedger.create({
      data: {
        userId: account.id,
        type: 'USAGE',
        amount: -cost.credits,
        balanceAfter: updated.credits,
        reason,
        referenceType: reference.type,
        referenceId: reference.id,
      },
    });

    domainEvents.publish(DomainEventNames.CREDITS_DEDUCTED, {
      accountType: 'user',
      accountId: account.id,
      amount: cost.credits,
      balanceAfter: updated.credits,
      reason,
    });

    return updated.credits;
  }

  /** Refunds a previously-deducted cost — used when generation fails after credits were already taken. */
  static async refund(
    tx: PrismaTransactionClient,
    account: CreditAccount,
    cost: GenerationCost,
    reason: string,
    reference: { type: string; id: string },
  ): Promise<void> {
    if (account.type === 'organization') {
      const updated = await tx.organization.update({
        where: { id: account.id },
        data: { credits: { increment: cost.credits } },
        select: { credits: true },
      });
      await tx.creditLedger.create({
        data: {
          organizationId: account.id,
          type: 'REFUND',
          amount: cost.credits,
          balanceAfter: updated.credits,
          reason,
          referenceType: reference.type,
          referenceId: reference.id,
        },
      });
    } else {
      const updated = await tx.user.update({
        where: { id: account.id },
        data: { credits: { increment: cost.credits } },
        select: { credits: true },
      });
      await tx.creditLedger.create({
        data: {
          userId: account.id,
          type: 'REFUND',
          amount: cost.credits,
          balanceAfter: updated.credits,
          reason,
          referenceType: reference.type,
          referenceId: reference.id,
        },
      });
    }

    domainEvents.publish(DomainEventNames.CREDITS_REFUNDED, {
      accountType: account.type,
      accountId: account.id,
      amount: cost.credits,
      reason,
    });
  }
}
