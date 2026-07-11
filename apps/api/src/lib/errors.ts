import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@watchly/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }

  static badRequest(message: string, fields?: Record<string, string>) {
    return new ApiError(400, 'BAD_REQUEST', message, fields);
  }

  static unauthorized(message = 'Not signed in.') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Not allowed.') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Not found.') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(code: string, message: string) {
    return new ApiError(409, code, message);
  }

  static validation(fields: Record<string, string>) {
    return new ApiError(422, 'VALIDATION_FAILED', 'Some fields need fixing.', fields);
  }
}

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function wrap<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Express only treats a 4-arg function as error middleware, so `next` must
  // stay in the signature even though it is unused.
  _next: NextFunction,
) {
  if (err instanceof ApiError) {
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message, ...(err.fields && { fields: err.fields }) },
    };
    res.status(err.status).json(body);
    return;
  }

  console.error('Unhandled error:', err);
  const body: ApiErrorBody = {
    error: { code: 'INTERNAL', message: 'Something went wrong on our end.' },
  };
  res.status(500).json(body);
}
