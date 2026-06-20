// application/http/route-handler.ts — Thin Controller Wrapper
//
// Every existing route in app/api/songs/* repeats the same shape:
//   try { ...business logic inline... } catch (error) {
//     console.error('X error:', error);
//     return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
//   }
// This wrapper extracts that boilerplate AND fixes a real information-
// leakage risk: several existing catch blocks return whatever shape the
// thrown error happens to have, while others always return a generic 500
// regardless of the actual failure (e.g. the retry route's catch swallows
// "Insufficient credits" thrown elsewhere into a blanket 500, when it
// should be a 402). Routing every thrown error through
// `domain-errors.ts`'s `toApiError()` makes the status code correct for
// EVERY route consistently, not just the ones someone remembered to
// special-case.

import { NextResponse } from 'next/server';
import { toApiError } from '@/Backend/domains/shared/errors/domain-errors';
import { randomUUID } from 'node:crypto';

export type RouteHandler<T> = () => Promise<T>;

/**
 * Wraps a route handler body. On success, returns the handler's result as
 * `{ ...data }` with the given status (default 200). On any thrown error,
 * maps it through `toApiError` and returns a consistent
 * `{ error: { code, message, details? } }` shape with the right status —
 * never a raw stack trace, never an inconsistent ad-hoc shape.
 *
 * Also attaches a `x-request-id` header to every response (success or
 * error) — a correlation ID that didn't exist anywhere in the original
 * routes, making it previously impossible to grep logs for "everything
 * that happened during this one request" across the route handler and any
 * downstream service/repository calls that also log using this ID.
 */
export async function handleRoute<T>(handler: RouteHandler<T>, successStatus = 200): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const result = await handler();
    const response = NextResponse.json(result, { status: successStatus });
    response.headers.set('x-request-id', requestId);
    return response;
  } catch (error) {
    const apiError = toApiError(error);

    // Internal errors get logged server-side with full detail; the
    // response to the client never includes anything beyond the safe
    // {code, message} from toApiError.
    if (apiError.status >= 500) {
      console.error(`[${requestId}] Unhandled error:`, error);
    }

    const response = NextResponse.json(
      { error: { code: apiError.code, message: apiError.message, details: apiError.details } },
      { status: apiError.status },
    );
    response.headers.set('x-request-id', requestId);
    return response;
  }
}
