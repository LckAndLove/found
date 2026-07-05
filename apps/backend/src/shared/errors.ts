export type ErrorCode = "BAD_REQUEST" | "NOT_FOUND" | "UPSTREAM_ERROR" | "INTERNAL_ERROR";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, "BAD_REQUEST", message, details);
    this.name = "BadRequestError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(404, "NOT_FOUND", message, details);
    this.name = "NotFoundError";
  }
}

export class UpstreamError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(502, "UPSTREAM_ERROR", message, details);
    this.name = "UpstreamError";
  }
}
