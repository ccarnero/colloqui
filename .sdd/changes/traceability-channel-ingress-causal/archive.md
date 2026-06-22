# Archive — `traceability-channel-ingress-causal`

**Date:** 2026-06-21  
**Status:** ✅ CLOSED

## Summary

Fixed the causal chain break in channel-service webhook ingress by threading `correlationId`, `causationId`, and `depth` from the `WebhookIngressEnvelope` through the existing call chain to `createChannelEnvelope`. The factory already accepted these parameters; the fix was purely additive call-site threading. As a result, the canonical `ChannelEnvelope` now inherits causal fields from the webhook envelope instead of resetting them, enabling `GET /audit/events/chain/:correlationId` to return the complete event tree for all inbound webhook messages.

## Files Changed

- `services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts` — Extract causal fields from `WebhookIngressEnvelope` and pass to `processEnvelope`.
- `services/channel-service/src/modules/webhooks/webhook-ingress.service.ts` — Add optional causal parameter to `processEnvelope` and thread through `scheduleIngress` to `IngressService`.
- `services/channel-service/src/modules/ingress/ingress.service.ts` — Extend `IProcessInboundOptions` and `IPublishMessageOptions` interfaces; thread causal fields to `createChannelEnvelope`.
- `services/channel-service/test/unit/webhook-ingress-causal.spec.ts` — New unit test verifying causal field inheritance across three cases (happy path, missing transport, no causal).
- `DOCS/messaging/envelope.md` — Removed the "as-built inconsistency" caveat from §6; the causal chain now propagates correctly.

## Acceptance Criteria Met

- ✅ TypeScript compilation clean (`bun run build`, no errors)
- ✅ Causal fields extracted from `WebhookIngressEnvelope` in consumer
- ✅ Fields threaded through `processEnvelope` → `scheduleIngress` → `processInbound` → `publishMessage` → `createChannelEnvelope`
- ✅ All new parameters optional; existing non-webhook callers unaffected
- ✅ Unit test passes three cases: happy path causal threading, missing transport field, no-causal fallback defaults
- ✅ Docs updated: removed stale inconsistency note from `DOCS/messaging/envelope.md §6`

## Verification Result

**PASS** — 141/141 tests green, TypeScript clean.

## Open Follow-up

`DOCS/messaging/envelope.md:22` — TOC entry still says "as-built inconsistencies" (plural); only the depth-tracker inconsistency in §6.3 remains after this fix. Non-blocking; update the TOC entry to "as-built inconsistency (depth-tracker)" in a future docs pass.

## Key Decision Points

See [ADR: Causal-field threading in webhook ingress](../../design.md) for design details. No new types, no new service boundaries; purely additive optional parameters on existing function signatures.
