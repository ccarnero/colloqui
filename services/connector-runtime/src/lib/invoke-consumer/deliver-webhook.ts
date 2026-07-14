// Port for delivering the async invoke result to the caller's webhook
// (`manual-loops/connector-invoke-api.md` T05). Declares ONLY the shape so
// `handle-invoke-requested-message.ts` stays free of a `fetch`/network
// import — the concrete implementation is
// `src/activities/_shared/webhook-delivery.ts`, injected by
// `invoke-consumer-main.ts`.
//
// CONTRACT (SPEC.md): "Webhook delivery failure -> warn + result still
// available by polling until TTL." `deliverWebhook` therefore NEVER throws
// on delivery failure — it resolves a `Result` so the caller can log a
// structured warning and continue (parking + ack already happened before
// this is even attempted; a webhook-down tenant must never block ack or
// lose the polling fallback).

import type { Result } from "../result";
import type { InvocationRecord, InvokeWebhookTarget } from "./types";

export interface WebhookDeliveryError {
  readonly message: string;
  readonly status?: number;
}

export type DeliverWebhook = (
  target: InvokeWebhookTarget,
  record: Extract<InvocationRecord, { status: "completed" }>
) => Promise<Result<{ readonly status: number }, WebhookDeliveryError>>;
