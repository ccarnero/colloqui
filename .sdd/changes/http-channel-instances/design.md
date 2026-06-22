# Design — http-channel-instances

## Goal

Close the three remaining gaps so that an HTTP channel **instance** (one channel
account = one addressable ingress URL) routes end-to-end and is usable from the
Admin Console without manual token lookup. Option B (per-instance URL +
`accountIds` trigger pin) is already deployed; this change makes the instance
path reliable and the developer experience complete.

## Scope

- **Gap 1** — Confirm the NATS consumer forwards `instance` (verify-only).
- **Gap 2** — Flip `FANOUT_PIN` default to `1` in the sample setup.
- **Gap 3** — Render the real `appSecret` in the per-account curl snippet.

Out of scope: gateway route, `resolveAccount` filtering, SDK wiring, trigger
`accountIds` matching — all already implemented and deployed.

## Architecture: how `instance` flows

The `instance` is the per-account `externalId`. It is carried as an explicit
field on the webhook envelope from the gateway URL all the way to account
resolution, where it pins routing to a single account instead of falling back to
token-only resolution.

```
POST /api/webhooks/http/<tenant>/<instance>
        │  (api-gateway: webhooks.controller.ts)
        │  builds WebhookIngressEnvelope { tenant, data:{ instance, raw_body_b64,
        │                                  headers, payload }, correlation_id, ... }
        ▼
   NATS JetStream  (subject INGRESS-<tenant>.webhook.http...)
        │
        ▼
WebhookIngressConsumerService.processMessage          [GAP 1 — verify]
        │  reads envelope.data.instance
        │  → processEnvelope(channel, tenant, rawBody, headers, payload,
        │                     causal, instance)
        ▼
WebhookIngressService.resolveAccount                  [already done]
        │  if (instance) filter accounts by externalId === instance
        │  else fall back to token-only resolution
        ▼
   Ingress publish  →  workflow-service trigger-consumer
        │  if (trigger.accountIds) match against resolved account.id  [already done]
        ▼
   Workflow fires ONLY for the pinned instance
```

If Gap 1 regressed (instance dropped at the consumer), `resolveAccount` silently
degrades to token-only routing: a workflow pinned via `accountIds` would only
fire when the caller happens to send the exact account token, and cross-instance
isolation is lost. Hence Gap 1 is a correctness invariant, not cosmetic.

## Gap 1 — Consumer forwards `instance` (VERIFY-ONLY)

**File:** `services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts`

**Status: already correct.** `processMessage` (lines 143-155) passes
`envelope.data?.instance` as the final argument to `processEnvelope`:

```ts
await this.webhookIngress.processEnvelope(
  subject.channel,
  subject.tenant,
  rawBody,
  this.normalizeHeaders(envelope.data?.headers),
  envelope.data?.payload ?? null,
  { correlationId: envelope.correlation_id,
    causationId: envelope.id,
    depth: (envelope.transport?.depth ?? 0) + 1 },
  envelope.data?.instance,   // <- present
);
```

No code change. The task is a guarded assertion: confirm the argument is present
and add a regression test so a future refactor cannot silently drop it.

## Gap 2 — FANOUT_PIN default → 1

**File:** `sdk/samples/http-fanout-telegram/setup.sh:89`

The redeploy that gives each instance its own URL is done, so the pin is now
safe to enable by default. The pin only matches when the message resolves to the
dedicated account, which the per-instance URL guarantees.

Before:
```sh
FANOUT_PIN="${FANOUT_PIN:-0}"
```

After:
```sh
FANOUT_PIN="${FANOUT_PIN:-1}"
```

Also update the surrounding Spanish comment (lines 84-88) so it states the pin
is ON by default post-redeploy and `FANOUT_PIN=0` is the opt-out for the
single-workflow case.

## Gap 3 — Real `appSecret` in the curl snippet

### Investigation

- `IChannelAccount` (admin model) **already declares** `appSecret?: string`
  (`channel-account.model.ts:16`).
- The channel-service `list` and `get` endpoints return the full account via
  `mapRow`, which **includes `app_secret`** with **no redaction**
  (`accounts.service.ts:36`, `accounts.controller.ts:62-75`).
- `appSecret` is auto-generated for `http` and `telegram` channels on create
  (`accounts.service.ts:60-63`).

Therefore the list response already carries the real token; the placeholder in
`ingestCurlFor` is the only thing standing between the user and a working curl.

### Decision: option (a) — use the value already on the account (one-liner)

No new endpoint, no creation-only modal. The list already returns `appSecret`, so
render it directly with a safe fallback to the placeholder when absent.

**File:** `services/admin-console/src/app/features/channels/channels.component.ts:300-307`

Before:
```ts
ingestCurlFor(account: IChannelAccount): string {
  return (
    `curl -X POST ${this.ingestUrlFor(account.externalId)} \\\n` +
    `  -H 'content-type: application/json' \\\n` +
    `  -H 'x-http-channel-token: <app-secret>' \\\n` +
    `  -d '{"from":"customer@example.com","text":"hello"}'`
  );
}
```

After:
```ts
ingestCurlFor(account: IChannelAccount): string {
  const token = account.appSecret ?? "<app-secret>";
  return (
    `curl -X POST ${this.ingestUrlFor(account.externalId)} \\\n` +
    `  -H 'content-type: application/json' \\\n` +
    `  -H 'x-http-channel-token: ${token}' \\\n` +
    `  -d '{"from":"customer@example.com","text":"hello"}'`
  );
}
```

### Rejected alternatives

- **(b) Copy-token-only-on-create**: worse UX — the token is needed for every
  existing account, not just at creation, and the snippet panel exists precisely
  to be revisited. Adds modal state for no benefit.
- **(c) Dedicated GET token endpoint**: unnecessary — the list already returns
  the secret. Would add an endpoint, a service method, and a round-trip to
  re-fetch data the page already holds.

### Security note (flagged, not blocking)

The list endpoint returns `appSecret` in plaintext to any authenticated console
user. This change does not widen exposure — the field is already on the wire and
the model — but it does make it visible in the UI. If the platform later wants to
redact secrets on list, the correct fix is a `reveal token` action backed by a
scoped endpoint (option c), applied uniformly across channels. Track separately;
do not couple to this change.

## Backward compatibility

- No schema changes, no migrations.
- No API contract changes — `appSecret` was already part of the list/get DTO.
- Gap 2 changes only a shell default; existing callers that set `FANOUT_PIN`
  explicitly are unaffected.
- `account.appSecret ?? "<app-secret>"` keeps the snippet valid for any account
  type that lacks a secret.
