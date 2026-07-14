// Port for the `invoke_completed` transport event
// (`manual-loops/connector-invoke-api.md` T05). Mirrors
// `http-facade/publish-invoke-request.ts`'s pattern: this file declares
// ONLY the shape so `handle-invoke-requested-message.ts` stays free of a
// `nats` import. The concrete implementation
// (`publishInvokeCompletedEvent`) lives in
// `src/activities/_shared/invoke-request-publisher.ts`, the one module
// allowed to import `nats` for this event family.
//
// BEST-EFFORT CONTRACT (T05, distinct from `invoke_requested`'s fail-loud
// publish): by the time this is called, the result is ALREADY parked in
// Redis (the polling fallback is durable). This event is a secondary,
// best-effort transport notification — its failure must never cause the
// consumer to nak and re-run the outbound HTTP call a second time just
// because the notification side-channel hiccuped. Implementations still
// reject on failure (so the caller can log a warning); they simply must
// not be treated as fatal by `handleInvokeRequestedMessage`.

import type { Result } from "../result";
import type { InvocationRecord } from "./types";

export interface PublishInvokeCompletedArgs {
  readonly tenantId: string;
  readonly invocationId: string;
  readonly connectorId: string;
  readonly endpointId: string;
  readonly record: Extract<InvocationRecord, { status: "completed" }>;
  readonly causal: {
    readonly correlation_id: string;
    readonly causation_id: string;
    readonly depth: number;
  };
}

export type PublishInvokeCompletedError = { readonly message: string };

export type PublishInvokeCompleted = (
  args: PublishInvokeCompletedArgs
) => Promise<Result<{ readonly subject: string }, PublishInvokeCompletedError>>;
