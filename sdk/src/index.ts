/**
 * @yoizen/platform-sdk — plain-Node ESM SDK for sending (ingesting) messages into the
 * platform via the http channel. Log in with tenant + email + password, then `send`.
 */

export {
  AuthError,
  ChannelResolutionError,
  ConfigError,
  ConflictError,
  IngestError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  SdkError,
  ValidationError,
} from "./domain/errors.js";
export type { Client } from "./infrastructure/create-client.js";
export { createClient } from "./infrastructure/create-client.js";
