/**
 * Error taxonomy for the SDK. Every error extends {@link SdkError} so callers can
 * `catch (e) { if (e instanceof SdkError) ... }` and branch on `e.code`.
 */

export interface SdkErrorOptions {
  code?: string;
  cause?: unknown;
  details?: unknown;
}

export class SdkError extends Error {
  code: string;
  cause?: unknown;
  details?: unknown;

  constructor(message: string, { code, cause, details }: SdkErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code ?? "SDK";
    if (cause !== undefined) {
      this.cause = cause;
    }
    if (details !== undefined) {
      this.details = details;
    }
  }
}

/** Missing/invalid client configuration (tenant, email, password, baseUrl). */
export class ConfigError extends SdkError {
  constructor(message: string, opts: SdkErrorOptions = {}) {
    super(message, { ...opts, code: "CONFIG" });
  }
}

/** Invalid message input (empty `from`, empty text, wrong types). */
export class ValidationError extends SdkError {
  constructor(message: string, opts: SdkErrorOptions = {}) {
    super(message, { ...opts, code: "VALIDATION" });
  }
}

/** Login or token refresh failed. `details.httpStatus` carries the HTTP status. */
export class AuthError extends SdkError {
  constructor(message: string, opts: SdkErrorOptions = {}) {
    super(message, { ...opts, code: "AUTH" });
  }
}

/** Could not resolve the http channel account / appSecret for the tenant. */
export class ChannelResolutionError extends SdkError {
  constructor(message: string, opts: SdkErrorOptions = {}) {
    super(message, { ...opts, code: "CHANNEL_RESOLUTION" });
  }
}

export interface IngestErrorOptions extends SdkErrorOptions {
  ingestStatus?: string;
}

/**
 * The ingest request failed, or the platform returned a non-"accepted" status.
 * `ingestStatus` holds the platform status string (e.g. "signature_mismatch").
 */
export class IngestError extends SdkError {
  ingestStatus?: string;

  constructor(message: string, opts: IngestErrorOptions = {}) {
    super(message, { ...opts, code: "INGEST" });
    if (opts.ingestStatus !== undefined) {
      this.ingestStatus = opts.ingestStatus;
    }
  }
}

/** The requested resource does not exist (HTTP 404). */
export class NotFoundError extends SdkError {
  constructor(message: string, opts: SdkErrorOptions = {}) {
    super(message, { ...opts, code: "NOT_FOUND" });
  }
}

/** The request conflicts with the current state of the resource (HTTP 409). */
export class ConflictError extends SdkError {
  constructor(message: string, opts: SdkErrorOptions = {}) {
    super(message, { ...opts, code: "CONFLICT" });
  }
}

/** The caller is authenticated but not authorized for this action (HTTP 403). */
export class PermissionError extends SdkError {
  constructor(message: string, opts: SdkErrorOptions = {}) {
    super(message, { ...opts, code: "PERMISSION" });
  }
}

export interface RateLimitErrorOptions extends SdkErrorOptions {
  /** Parsed from the `Retry-After` response header, in milliseconds, when present. */
  retryAfterMs?: number;
}

/** The caller has been rate-limited (HTTP 429). Carries `retryAfterMs` when the server sent `Retry-After`. */
export class RateLimitError extends SdkError {
  retryAfterMs?: number;

  constructor(message: string, opts: RateLimitErrorOptions = {}) {
    super(message, { ...opts, code: "RATE_LIMIT" });
    if (opts.retryAfterMs !== undefined) {
      this.retryAfterMs = opts.retryAfterMs;
    }
  }
}
