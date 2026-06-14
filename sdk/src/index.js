/**
 * @yoizen/http-sdk — plain-Node ESM SDK for sending (ingesting) messages into the
 * platform via the http channel. Log in with tenant + email + password, then `send`.
 */

export { createClient } from "./infrastructure/create-client.js";
export {
  SdkError,
  ConfigError,
  ValidationError,
  AuthError,
  ChannelResolutionError,
  IngestError,
} from "./domain/errors.js";
