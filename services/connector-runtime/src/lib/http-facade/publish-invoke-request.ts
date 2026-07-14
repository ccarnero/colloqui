// Port for the `invoke_requested` transport event published by the async
// invoke facade (`manual-loops/connector-invoke-api.md` T04). Mirrors
// `endpoint-call-core/types.ts`'s `EndpointCallEventSink` pattern: this file
// declares ONLY the shape of the port so `handle-invoke-request.ts` stays
// free of a `nats` import (SPEC.md pure-core constraint). The concrete
// JetStream-backed implementation is
// `src/activities/_shared/invoke-request-publisher.ts`'s
// `publishInvokeRequestEvent`, injected by the entrypoint (`http-main.ts`).

import type { EndpointCallArgs, EventCausalContext } from "@yoizen/shared";
import type { Result } from "../result";

export interface PublishInvokeRequestArgs {
  readonly tenantId: string;
  readonly invocationId: string;
  readonly connectorId: string;
  readonly endpointId: string;
  readonly args: EndpointCallArgs;
  /**
   * Causal context — always absent today (the HTTP facade is a standalone
   * root invocation, same as the sync path's `executeEndpointCallCore`
   * call), kept so a future workflow-originated async invoke can thread a
   * real chain without changing this port's shape.
   */
  readonly causal?: EventCausalContext;
}

export type PublishInvokeRequestError = { readonly message: string };

/**
 * Publishes the `invoke_requested` transport envelope and resolves once the
 * broker has acknowledged the write (or rejects with a descriptive error —
 * NEVER falls back to a non-streamed publish for this subject; see
 * `invoke-request-publisher.ts`'s fail-loud contract).
 */
export type PublishInvokeRequest = (
  args: PublishInvokeRequestArgs
) => Promise<Result<{ readonly subject: string }, PublishInvokeRequestError>>;
