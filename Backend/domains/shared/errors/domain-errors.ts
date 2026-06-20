// domains/shared/errors/domain-errors.ts — Domain Error Hierarchy
//
// Extends the existing `AppError`/`Errors` helper (enterprise/core/errors.ts)
// rather than replacing it — that file is kept as-is and re-exported here so
// existing imports (`@/Backend/enterprise/core/errors`) keep working during
// migration. New domain code should import from here going forward; the
// generic `Errors.*` helpers remain available for cases that don't warrant
// a dedicated subclass.
//
// Why subclass at all, instead of just using `AppError` everywhere: a
// dedicated class per failure family lets use-case callers do
// `if (err instanceof InsufficientCreditsError)` instead of string-matching
// `err.code === 'INSUFFICIENT_CREDITS'`, which is what the codebase did
// before (see SongGenerationService.createSong throwing plain `new Error(...)`
// with no machine-readable code at all — this fixes that specific gap).

import { AppError } from '@/Backend/enterprise/core/errors';

export { AppError, Errors } from '@/Backend/enterprise/core/errors';

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('VALIDATION_ERROR', 'Validation failed', 400, details);
  }
}

export class InsufficientCreditsError extends AppError {
  constructor(required: number, available: number) {
    super(
      'INSUFFICIENT_CREDITS',
      `Insufficient credits. Required: ${required}, available: ${available}.`,
      402,
      { required, available },
    );
  }
}

export class AccountInactiveError extends AppError {
  constructor(accountType: 'user' | 'organization') {
    super('ACCOUNT_INACTIVE', `This ${accountType} account is inactive`, 403);
  }
}

/** Thrown by domain services when an external dependency (AI provider, S3, queue) fails. Distinct from validation/auth errors — these are retryable infrastructure failures, not client mistakes. */
export class InfrastructureError extends AppError {
  constructor(component: string, cause?: unknown) {
    super('INFRASTRUCTURE_ERROR', `${component} is currently unavailable`, 503, {
      cause: cause instanceof Error ? cause.message : cause,
    });
  }
}

/** Thrown when a generation job's state machine is violated — e.g. attempting to retry a job that's still QUEUED, or complete a job that was already CANCELLED. */
export class InvalidJobStateError extends AppError {
  constructor(currentState: string, attemptedAction: string) {
    super(
      'INVALID_JOB_STATE',
      `Cannot ${attemptedAction} a job in state ${currentState}`,
      409,
      { currentState, attemptedAction },
    );
  }
}

/**
 * Maps any thrown error to a safe, consistent {code, message, status}
 * shape for API responses — never leaks stack traces, raw Prisma error
 * messages, or other internal details to the client. This is the single
 * place that decides "is this safe to show the user" for the whole AI
 * domain, replacing the per-route `console.error(...); return 500` pattern
 * seen throughout the existing routes.
 */
export function toApiError(err: unknown): { code: string; message: string; status: number; details?: unknown } {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, status: err.status, details: err.details };
  }
  // Unknown errors (Prisma errors, network errors, etc.) — never expose
  // the raw message, which could contain table names, connection strings,
  // or other internals.
  return { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', status: 500 };
}
