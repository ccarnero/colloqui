// SSRF guard shared by the webhook delivery activity (`webhook-delivery.ts`)
// and request validation (`parse-invoke-request-body.ts`). Mirrors the
// precedent already established in this same service — `validateUrl` in
// `mcp-call.activity.ts` (itself ported from `agent-ai-service`'s
// `webhook-action.service.ts`/`adapter-executor.service.ts`/
// `mcp-tools-probe.service.ts`) — but returns a `Result` instead of
// throwing a Temporal `ApplicationFailure`, so it is usable both at
// request-validation time (mapped onto a 400 response, no HTTP call ever
// attempted) and at delivery time (best-effort warn + skip, never throws;
// defense in depth for envelopes that crossed the broker).
//
// T06 (manual-loops/declarative-provisioning.md) extracted the actual check
// to `@yoizen/shared`'s `validate-outbound-url.ts` so `provisioning-service`
// can reuse it for the KB `url:` source fetch instead of re-implementing it;
// this file is now a thin re-export so existing imports in this service
// (`./validate-outbound-url`) keep working unchanged.

export { validateOutboundUrl } from "@yoizen/shared";
