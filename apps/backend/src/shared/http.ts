import type { ErrorRequestHandler, RequestHandler } from "express";
import { ApiError } from "./errors.js";

export const asyncHandler = (handler: RequestHandler): RequestHandler => {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "服务异常");

  response.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details ? { details: apiError.details } : {})
    }
  });
};
