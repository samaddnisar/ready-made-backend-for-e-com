/**
 * One error envelope everywhere (§8):
 *   success → { data }
 *   failure → { error: { code, message, details? } }
 */

export type ErrorCode =
  | "bad_request"
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "payment_error"
  | "out_of_stock"
  | "cart_expired"
  | "internal_error";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_error: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  payment_error: 402,
  out_of_stock: 409,
  cart_expired: 410,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown, status?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status ?? STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const notFound = (message = "Not found") => new AppError("not_found", message);
export const unauthorized = (message = "Authentication required") =>
  new AppError("unauthorized", message);
export const forbidden = (message = "You don't have permission to do that") =>
  new AppError("forbidden", message);
export const badRequest = (message: string, details?: unknown) =>
  new AppError("bad_request", message, details);
export const validationError = (details: unknown) =>
  new AppError("validation_error", "Invalid input", details);
export const conflict = (message: string, details?: unknown) =>
  new AppError("conflict", message, details);

export type ApiSuccess<T> = { data: T };
export type ApiFailure = { error: { code: ErrorCode; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function toFailure(err: unknown): { body: ApiFailure; status: number } {
  if (err instanceof AppError) {
    return {
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
      status: err.status,
    };
  }

  // Safety net for constraint errors that slip past service-level validation:
  // surface friendly 4xx instead of a generic 500 (§9 graceful failures).
  const pgCode = (err as { code?: unknown })?.code;
  if (pgCode === "23505") {
    return {
      body: {
        error: {
          code: "conflict",
          message: "A record with this value already exists (duplicate slug, SKU or code)",
        },
      },
      status: 409,
    };
  }
  if (pgCode === "23503") {
    return {
      body: {
        error: { code: "bad_request", message: "A referenced record does not exist" },
      },
      status: 400,
    };
  }

  // Never leak internals (§9) — log the real error at the call site.
  return {
    body: { error: { code: "internal_error", message: "Something went wrong" } },
    status: 500,
  };
}
