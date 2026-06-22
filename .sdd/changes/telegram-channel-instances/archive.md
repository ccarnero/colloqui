# Archive: telegram-channel-instances

**Date**: 2026-06-27  
**Status**: CLOSED — 9/9 acceptance criteria PASS

---

## Summary

Fixed three configuration gaps in the `telegram-transform-reply` sample to enable per-instance webhook routing and workflow trigger pinning. The infrastructure (gateway, channel-service, workflow-service) already supported these features; the sample was simply not using them. All changes are scoped to the sample only; zero service changes.

**What shipped**:
1. Webhook registration URL now includes the instance segment (`/api/webhooks/telegram/<tenant>/<externalId>`)
2. Simulated inbound posts to the same instance URL
3. Workflow trigger conditionally pins to the specific account via `accountIds` when `TG_PIN=1` (default) 
4. README updated with architecture diagram, configuration table (`TG_PIN` row), and inverted troubleshooting guidance

**Key decisions** (see [ADR](./adr.md)):
- **Decision 1**: Use `externalId` (not database `id`) as the instance URL segment — matches gateway routing and mirrors the HTTP fanout pattern
- **Decision 2**: Pin workflow trigger ON by default (`TG_PIN=1`); disallow opt-out via `TG_PIN=0` — safer default for multi-bot tenants, consistent with `FANOUT_PIN`
- **Decision 3**: Sample-only scope — no service-layer changes required; infrastructure already generic

**Files modified**:
- `sdk/samples/telegram-transform-reply/setup.sh` — EXTERNAL_ID global, webhook path, simulate-inbound URL, trigger accountIds
- `sdk/samples/telegram-transform-reply/README.md` — architecture diagram, config table, troubleshooting sections

**Backward compatibility**: Tenant-level webhook routes (`/api/webhooks/telegram/<tenant>`) continue to work; existing bots unaffected. New provisioning uses the instance URL by default.

---

## Verification Result

**PASS** — 9/9 acceptance criteria green:

1. ✓ EXTERNAL_ID logged on reuse path (TG_RECREATE=0)
2. ✓ New EXTERNAL_ID generated on create path (TG_RECREATE=1)
3. ✓ Webhook registration curl includes instance segment
4. ✓ Simulate-inbound curl includes instance segment
5. ✓ Workflow trigger includes accountIds when TG_PIN=1
6. ✓ Workflow trigger omits accountIds when TG_PIN=0
7. ✓ README architecture diagram updated
8. ✓ README configuration table includes TG_PIN row
9. ✓ README troubleshooting inverted (accountIds now expected)
