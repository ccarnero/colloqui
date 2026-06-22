# Tasks — `traceability-channel-ingress-causal`

Three tasks, in dependency order. Each can be verified independently.

---

## Task 1 — Thread causal params through the 3 source files

**Status:** [x] complete

### Description

Propagate `correlationId`, `causationId`, and `depth` from the NATS consumer down to the envelope
factory by making the minimum necessary changes in three files. All new params are optional; no
existing callers are broken.

### Files affected

1. `services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts`
2. `services/channel-service/src/modules/webhooks/webhook-ingress.service.ts`
3. `services/channel-service/src/modules/ingress/ingress.service.ts`

### Changes per file

**File 1 — `webhook-ingress-consumer.service.ts`**

In `processMessage` (L143–L149), extract causal fields from `envelope` before the
`processEnvelope` call and pass them as the new 6th argument:

```typescript
// L143 — replace current call:
await this.webhookIngress.processEnvelope(
  subject.channel,
  subject.tenant,
  rawBody,
  this.normalizeHeaders(envelope.data?.headers),
  envelope.data?.payload ?? null,
  // new causal arg:
  {
    correlationId: envelope.correlation_id,
    causationId: envelope.id,
    depth: (envelope.transport?.depth ?? 0) + 1,
  },
);
```

**File 2 — `webhook-ingress.service.ts`**

`processEnvelope` signature (L70–L76): add optional 6th parameter:

```typescript
async processEnvelope(
  channel: string,
  tenantId: string,
  rawBody: Buffer,
  headers: Record<string, string>,
  parsedBody: unknown,
  causal?: { correlationId?: string; causationId?: string | null; depth?: number },
): Promise<{ status: string }>
```

`scheduleIngress` options object (L250–L255): add `causal` field and thread it through:

```typescript
private scheduleIngress(options: {
  tenantId: string;
  channelType: Channel;
  provider: IChannelProvider;
  account: IAccountWithSecret;
  messages: InboundMessage[];
  causal?: { correlationId?: string; causationId?: string | null; depth?: number };
}): void
```

Inside `scheduleIngress` (L258–L266), pass causal into `processInbound`:

```typescript
this.ingress.processInbound({
  tenantId,
  channel: channelType,
  provider: provider.provider,
  accountId: account.id,
  messages,
  ...causal,  // spreads correlationId?, causationId?, depth? or nothing
})
```

The call site at L134 (`this.scheduleIngress(...)`) must also pass the new `causal` field from the
`processEnvelope` param.

**File 3 — `ingress.service.ts`**

Extend `IProcessInboundOptions` (L39–L44) and `IPublishMessageOptions` (L47–L53) with three
optional fields each:

```typescript
interface IProcessInboundOptions {
  tenantId: string;
  channel: Channel;
  provider: ChannelProvider;
  accountId: string;
  messages: InboundMessage[];
  correlationId?: string;
  causationId?: string | null;
  depth?: number;
}

interface IPublishMessageOptions {
  tenantId: string;
  channel: Channel;
  provider: ChannelProvider;
  accountId: string;
  message: InboundMessage;
  correlationId?: string;
  causationId?: string | null;
  depth?: number;
}
```

In `processInbound` (L109–L120), destructure the new fields and forward to each `publishMessage`
call:

```typescript
const { tenantId, channel, provider, accountId, messages, correlationId, causationId, depth } = options;
// ...
this.publishMessage({ tenantId, channel, provider, accountId, message: msg, correlationId, causationId, depth })
```

In `publishMessage` (L142–L153), destructure and pass to factory:

```typescript
const { tenantId, channel, provider, accountId, message, correlationId, causationId, depth } = options;
const envelope = createChannelEnvelope({
  tenantId, channel, provider,
  kind: "received",
  message,
  accountId,
  correlationId,
  causationId,
  depth,
});
```

### Acceptance criteria

- TypeScript compilation passes with no errors (`bun run build` or `tsc --noEmit` in channel-service).
- `processEnvelope` can be called without the `causal` argument (existing call sites in tests remain valid).
- `processInbound` can be called without `correlationId`/`causationId`/`depth` (non-webhook paths unchanged).
- Reading the method signatures confirms all new params are marked `?`.

---

## Task 2 — Unit test: canonical envelope inherits causal fields from webhook envelope

**Status:** [x] complete

### Description

Add a focused unit test that proves the factory receives the correct causal values when called via
the full threading path (or directly with the threaded values). This is the acceptance test from the
spec.

### File affected

`services/channel-service/test/unit/webhook-ingress-causal.spec.ts` (new file)

### Test cases

**Case 1 — happy path causal threading:**
Given a `WebhookIngressEnvelope` with `id="W"`, `correlation_id="C"`,
`transport.depth=0`, the `ChannelEnvelope` produced by `createChannelEnvelope` (called with the
extracted causal values) has:
- `causation_id === "W"`
- `correlation_id === "C"`
- `transport.depth === 1`

**Case 2 — missing transport field (older webhook):**
Given a webhook with `id="W2"`, `correlation_id="C2"`, and no `transport` field,
`createChannelEnvelope` receives `depth=1` (`(undefined?.depth ?? 0) + 1`).
- `transport.depth === 1`

**Case 3 — no causal (non-webhook caller default):**
Call `createChannelEnvelope` without `correlationId`/`causationId`/`depth`.
- `causation_id === null`
- `correlation_id === envelope.id` (factory default: own id)
- `transport.depth === 0`

The test imports `createChannelEnvelope` directly from
`../../src/domain/envelope.factory` and constructs minimal valid `InboundMessage` stubs.
No NATS mock, no NestJS test module required.

### Acceptance criteria

- `bun test` (or `vitest run`) in channel-service passes all three cases.
- Test file is self-contained: no NestJS bootstrap, no NATS infrastructure.
- Test covers the no-`transport` regression guard (Case 2).

---

## Task 3 — Docs: remove as-built inconsistency note from `DOCS/messaging/envelope.md §6`

**Status:** [x] complete

### Description

The spec references an "as-built inconsistency" note about the ingress causal break. Now that the
fix is implemented, that note is stale and must be removed.

### File affected

`DOCS/messaging/envelope.md`

### What to change

Locate any caveat or note block in §6 (Causal Chain) or §8 (Traceability) that states channel-service
does NOT propagate `correlation_id`/`causation_id`/`depth` from the webhook envelope to the
canonical envelope during two-stage ingress. Remove that block entirely.

Do NOT remove or edit:
- The §6.2 example (it shows the CORRECT intended behavior — keep it).
- The §6.3 depth-tracker inconsistency note (that is about `DepthTrackerService` in agent-ai-service,
  a separate unresolved issue).
- The §8 cutover note about pre-2026-06-20 events (that is a permanent historical note).
- Any other content in §6 or §8.

### Acceptance criteria

- The file no longer contains any caveat stating that the webhook-to-canonical causal chain is broken
  or incomplete in channel-service.
- §6.2 example and §6.3 depth-tracker note are untouched.
- `git diff` shows only the removed caveat block — no other lines changed.
