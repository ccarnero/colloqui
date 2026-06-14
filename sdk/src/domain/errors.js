/**
 * Error taxonomy for the SDK. Every error extends {@link SdkError} so callers can
 * `catch (e) { if (e instanceof SdkError) ... }` and branch on `e.code`.
 */

export class SdkError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, cause?: unknown, details?: unknown }} [opts]
   */
  constructor(message, { code, cause, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code ?? "SDK";
    if (cause !== undefined) this.cause = cause;
    if (details !== undefined) this.details = details;
  }
}

/** Missing/invalid client configuration (tenant, email, password, baseUrl). */
export class ConfigError extends SdkError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: "CONFIG" });
  }
}

/** Invalid message input (empty `from`, empty text, wrong types). */
export class ValidationError extends SdkError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: "VALIDATION" });
  }
}

/** Login or token refresh failed. `details.httpStatus` carries the HTTP status. */
export class AuthError extends SdkError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: "AUTH" });
  }
}

/** Could not resolve the http channel account / appSecret for the tenant. */
export class ChannelResolutionError extends SdkError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: "CHANNEL_RESOLUTION" });
  }
}

/**
 * The ingest request failed, or the platform returned a non-"accepted" status.
 * `ingestStatus` holds the platform status string (e.g. "signature_mismatch").
 */
export class IngestError extends SdkError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: "INGEST" });
    if (opts.ingestStatus !== undefined) this.ingestStatus = opts.ingestStatus;
  }
}
