# OpenAPI coverage — remaining gaps

Generated as part of P0.2 (OpenAPI spec at `/api/docs` + `/api/docs-json`).
`@ApiTags(...)` was added to every controller so all routes are grouped and
show up in the spec automatically. This file tracks what's left for full
schema fidelity.

## DTOs still missing `@ApiProperty()` / `@ApiPropertyOptional()`

These are real `class`-based DTOs (already used by `class-validator` +
the gateway's global `ValidationPipe`), so decorating them is a mechanical
continuation of the pattern applied to `admin.dto.ts`, `auth.dto.ts`,
`tenants.dto.ts`, and `workflows-gateway.dto.ts`. Nothing structural is
blocking this — it just wasn't done in this pass:

- `src/modules/channels/channels-gateway.dto.ts` — 10 classes (`ListChannelAccountsQueryDto`, `ChannelStreamQueryDto`, `ListAutoReplyRulesQueryDto`, `CreateChannelAccountBodyDto`, `UpdateChannelAccountBodyDto`, `SendChannelMessageBodyDto`, `UsageQueryGatewayDto`, `UsageTotalsQueryGatewayDto`, `StreamMessagesQueryGatewayDto`, `CreateAutoReplyRuleBodyDto`)
- `src/modules/connectors/connectors.dto.ts` — 6 classes (`HeaderEntryDto`, `CacheStrategyDto`, `CreateEndpointDto`, `CreateAdapterDto`, `UpdateAdapterDto`, `UpdateEndpointDto`)
- `src/modules/registry/registry.dto.ts` — 5 classes (`RegisterServiceDto`, `UpdateServiceDto`, `StartCanaryDto`, `UpdateCanaryDto`, `CreateRouteDto`)
- `src/modules/audit/audit-proxy-query.dto.ts` — 2 classes (`QueryAuditEventsProxyDto`, `QueryChannelEventsProxyDto`)
- `src/modules/channels/webhooks-gateway.dto.ts` — 2 classes (`WebhookVerificationQueryDto`, `WebhookInboundBodyDto`)
- `src/modules/runtime/runtime.dto.ts` — 2 classes (`ExecutionContextEntryDto`, `CreateExecutionDto`)

Without decoration, Swagger still lists these endpoints and infers a bare
`object` schema from the TS type (via `@nestjs/swagger`'s CLI plugin is
NOT configured in this repo, so there's no automatic property inference —
undecorated properties won't appear in the schema at all, only the shape
of the class as `{}`).

## Endpoints with no gateway-local DTO (passthrough / effectively `any`)

These controllers accept `@Body() body: unknown` and forward the payload
verbatim to an internal service (no validation, no schema at the gateway
layer — the internal service owns the contract):

- `src/modules/admin/admin-system-variables.controller.ts` (`admin/system-variables`)
- `src/modules/admin/admin-skills.controller.ts` (`admin/skills`)
- `src/modules/admin/admin-structured-kb.controller.ts` (`admin/structured-kb`)
- `src/modules/admin/admin-knowledge-bases.controller.ts` (`admin/knowledge-bases`, `admin/knowledge-bases/:kbId/documents`) — some endpoints use `CreateAgentDto`-adjacent shapes already decorated in `admin.dto.ts`; others (document upload/update) are `unknown`.

A future contributor closing this gap has two options: (a) hand-write
gateway-local DTOs mirroring each internal service's real request/response
shape (most accurate, more work), or (b) at minimum give these routes a
`@ApiBody({ schema: { type: 'object' } })` / `@ApiResponse(...)` so the
spec doesn't silently omit the request shape.

## Structural finding: most business logic and DTOs live in internal services, not the gateway

The api-gateway is a thin edge layer — most controllers proxy to internal
services (`admin-proxy.service.ts`, `*-proxy.service.ts`, etc.) via
`fetch()`. Gateway-local DTOs exist only where the gateway itself needs to
validate/shape the request before proxying (see `src/modules/**/*.dto.ts`).
Where the gateway just forwards `unknown`/`Record<string, unknown>`
bodies, the authoritative request/response contract lives in the internal
service's own OpenAPI/DTOs (if any), which this spec does not currently
aggregate. Full end-to-end spec fidelity would require either:

1. Duplicating each internal service's DTOs at the gateway (accuracy cost:
   drift risk between the two copies), or
2. A spec-aggregation step that merges the gateway's own OpenAPI doc with
   each internal service's OpenAPI doc for the paths it proxies verbatim.

Neither was attempted here — out of scope for P0.2, which only wires up
the gateway's own spec.

## Response schemas

No controller in this pass got explicit `@ApiResponse()` / `@ApiOkResponse()`
decorators — response shapes are inferred from method return types where
`@nestjs/swagger`'s reflection can determine them (mostly `Promise<object>`
or `unknown`, which yields no useful schema). Adding real response DTOs is
a separate, larger task and is not tracked item-by-item here.
