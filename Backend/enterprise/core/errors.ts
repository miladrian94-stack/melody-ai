export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

export const Errors = {
  unauthorized: () => new AppError('UNAUTHORIZED', 'Unauthorized', 401),
  forbidden: () => new AppError('FORBIDDEN', 'Forbidden', 403),
  notFound: (name = 'Resource') => new AppError('NOT_FOUND', `${name} not found`, 404),
  insufficientCredits: () => new AppError('INSUFFICIENT_CREDITS', 'Insufficient credits. Please upgrade or buy more credits.', 402),
  validation: (details?: unknown) => new AppError('VALIDATION_ERROR', 'Validation failed', 400, details),
};
