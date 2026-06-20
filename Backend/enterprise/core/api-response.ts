import { NextResponse } from 'next/server';

export type ApiSuccess<T> = { success: true; data: T; error: null; meta?: Record<string, unknown> };
export type ApiFailure = { success: false; data: null; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ success: true, data, error: null, ...(meta ? { meta } : {}) }, { status });
}

export function fail(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json<ApiFailure>({ success: false, data: null, error: { code, message, details } }, { status });
}

export function created<T>(data: T, meta?: Record<string, unknown>) {
  return ok(data, meta, 201);
}
