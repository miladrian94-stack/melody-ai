// domains/shared/events/event-bus.ts — Domain Event Bus
//
// Deliberately an in-process EventEmitter wrapper, NOT a Kafka/SNS/EventBridge
// integration — this codebase has no message broker beyond Redis/BullMQ
// (confirmed: package.json has ioredis + bullmq, nothing else). Building
// against a broker that isn't actually provisioned would produce dead code.
//
// This bus decouples "a thing happened" from "what should happen next"
// within a single process — e.g. SongGenerationUseCase doesn't need to know
// that completing a job should trigger an email AND a usage-metric write AND
// a websocket push; it just emits `ai.job.completed` and walks away.
//
// IMPORTANT BOUNDARY: this bus does NOT span processes. The web app and the
// worker are separate Node processes (per workers/enterprise-ai-worker.ts) —
// an event emitted in the worker is NOT received by listeners registered in
// the web app, and vice versa. Cross-process notification already has a
// real mechanism in this codebase (BullMQ jobs via infrastructure/queue/),
// and a websocket layer (lib/websocket.ts) for push-to-browser. This bus is
// for in-process decoupling only; don't reach for it as a replacement for
// either of those.

import { EventEmitter } from 'node:events';

export interface DomainEvent<TPayload = unknown> {
  readonly name: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

class DomainEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Domain events can legitimately have many listeners (audit logging,
    // metrics, notifications all listening to the same event) — raise the
    // default limit of 10 rather than let Node warn/throw.
    this.emitter.setMaxListeners(50);
  }

  publish<TPayload>(name: string, payload: TPayload): void {
    const event: DomainEvent<TPayload> = { name, occurredAt: new Date(), payload };
    this.emitter.emit(name, event);
  }

  subscribe<TPayload>(name: string, handler: (event: DomainEvent<TPayload>) => void | Promise<void>): () => void {
    const wrapped = (event: DomainEvent<TPayload>) => {
      // Listener failures must never crash the publisher or take down
      // other listeners — domain events are fire-and-forget side effects,
      // not part of the primary transaction's success/failure path.
      Promise.resolve(handler(event)).catch((err) => {
        console.error(`[event-bus] listener for "${name}" threw:`, err);
      });
    };
    this.emitter.on(name, wrapped);
    return () => this.emitter.off(name, wrapped);
  }
}

export const domainEvents = new DomainEventBus();

// ── Canonical event name constants ──────────────────────────────────────
// Centralizing names as constants (rather than ad-hoc strings scattered
// across use-cases) is what makes it possible to grep "who listens to
// ai.job.completed" and get a real answer.
export const DomainEventNames = {
  SONG_QUEUED: 'song.queued',
  SONG_GENERATION_STARTED: 'song.generation.started',
  SONG_GENERATION_PROGRESS: 'song.generation.progress',
  AI_JOB_COMPLETED: 'ai.job.completed',
  AI_JOB_FAILED: 'ai.job.failed',
  CREDITS_DEDUCTED: 'credits.deducted',
  CREDITS_REFUNDED: 'credits.refunded',
  USER_CREATED: 'user.created',
  SUBSCRIPTION_UPDATED: 'subscription.updated',
} as const;

export type DomainEventName = (typeof DomainEventNames)[keyof typeof DomainEventNames];
