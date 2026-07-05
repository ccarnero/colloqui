/**
 * `@yoizen/platform-sdk/core` — shared cross-cutting machinery for resource
 * clients: session/token lifecycle, authenticated transport, retry policy,
 * and pagination. See sdk/GROWTH-PLAN.md Phase 1.
 */

export type {
  FetchPage,
  PageResult,
  Paginated,
  PaginateOptions,
} from "./pagination.js";
export { paginate, toOffsetPage, toSinglePage } from "./pagination.js";
export type {
  ExecuteWithRetryOptions,
  ResolveRetryPolicyArgs,
  RetryConfig,
  RetryPolicy,
} from "./retry.js";
export {
  computeBackoffMs,
  executeWithRetry,
  isRetryableByDefault,
  isRetryableError,
  resolveRetryPolicy,
} from "./retry.js";
export type { Session, SessionConfig, SessionDeps } from "./session.js";
export { createSession } from "./session.js";
export type {
  ApiVersion,
  CreateTransportDeps,
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "./transport.js";
export { createTransport } from "./transport.js";
