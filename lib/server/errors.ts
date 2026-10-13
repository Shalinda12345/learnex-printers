import "server-only";

/** An error that is safe to show the user, with the HTTP status to answer with. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
/** The request is malformed or invalid (400). */
export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}
/** Not signed in, or the session has ended (401). */
export class UnauthorizedError extends HttpError {
  constructor(message = "Please sign in.", code = "unauthenticated") {
    super(401, message, code);
  }
}
/** Signed in, but not allowed to do this (403). */
export class ForbiddenError extends HttpError {
  constructor(message = "You don't have permission to do that.", code = "forbidden") {
    super(403, message, code);
  }
}
export class NotFoundError extends HttpError {
  constructor(message = "Not found.") {
    super(404, message);
  }
}
/** Conflicts with existing data, e.g. a username that's taken (409). */
export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}
