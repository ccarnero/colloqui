# hosted-services-api

Registers a tenant-scoped **hosted service** through the platform API, creates a dynamic route for
it, and wires a workflow that calls the hosted service and sends a Telegram notification.
Provisioning is **declarative**: a single [`manifest.yaml`](./manifest.yaml) applied through the
`yoizen` CLI (no setup scripts).

```
manifest.yaml ─► yoizen manifests apply ─► registry-service ─► Knative Service
                                        └─► gateway dynamic route (/samples/hosted-echo)
                                        └─► workflow-service (hosted-service-telegram)

HTTP webhook ─► workflow-service ─► serviceCall(sample-echo) ─► Telegram
```

## What `manifest.yaml` provisions

1. **A hosted service** (`sample-echo`) — image `ealen/echo-server:latest`, `port: 8080`,
   `minScale: 0`, `maxScale: 2`, `concurrencyTarget: 25` — a Knative Service in the tenant
   namespace, reconciled through the T05 scaling fields.
2. **A route** (`/samples/hosted-echo`, `GET`/`POST`, public, `stripPrefix: true`) — reconciled
   through `client.registry.routes` (T05).
3. **A dedicated HTTP channel account** (`hosted-services-api`) — this workflow's own ingest
   instance.
4. **A workflow** (`hosted-service-telegram`) — `serviceCall` (invokes the hosted service) →
   `jsFunction` (summarizes the echoed response) → `channelSend` (DMs the summary via Telegram).
   `serviceId` is a `serviceRef` (T03), resolved to the real `registered_services` row id at apply
   time — never a manifest-time id baked into the workflow.
5. **A system variable** (`hosted-services-api-chat-id`) — the Telegram chat id the notify step
   DMs. See § Configure below.

> **Cross-sample dependency (Telegram account).** The `notify` step's `accountId` is a
> `channelRef` to `telegram-transform-reply-bot`, declared `external: true` in this manifest — it
> is resolved by NAME against LIVE platform state, never created here. Apply
> [`../../channels/telegram-transform-reply/manifest.yaml`](../../channels/telegram-transform-reply/manifest.yaml)
> first, or this manifest's `apply` fails loud with `unresolvable_external_ref`.

## Historical note (env vars — the old gap is CLOSED)

The deleted `setup.ts` declared one env var on the hosted service,
`envVars: { YOIZEN_SAMPLE: "hosted-services-api" }` — a non-functional debug marker read by
nothing in the workflow or the echo-server image. When this sample was migrated, manifest v1
could not express it and `registry-services-writer.ts`'s `checkEnvSupport()` rejected any
non-empty `env` array, so it was dropped rather than approximated.

**That restriction no longer exists.** `checkEnvSupport()` is gone; `serviceSchema.env` now takes
`{ name, value }` where `value` is a plain string, `{ secretRef }`, `{ connectorRef }`, or a
connector-endpoint ref (`serviceEnvValueSchema`, `packages/shared/src/provisioning/
manifest.schema.ts`), and `registry-services-writer.ts`'s `buildEnvVars()` resolves each shape —
literal strings pass through, a `secretRef` becomes a k8s-native `valueFrom.secretKeyRef` and its
VALUE is never forwarded. The sibling `../../ai/ai-call-center-supervisor/manifest.yaml` already
ships `env: [{ name: YOIZEN_SAMPLE, value: ai-call-center-supervisor }]` on its hosted service.

This sample's `manifest.yaml` still omits the marker: it changes no observable behavior, so there
is nothing to demonstrate by adding it. If you DO add an `env` entry, the planner sees it — the
`kind === "service"` branch of `build-manifest-plan.ts` projects both sides through
`serviceEnvMechanismComparable`, which emits one `{ name, mechanism, value? }` entry per env var;
for a plain literal the desired side always carries `value`, while the live side echoes `value`
only when the running value is byte-for-byte equal, and otherwise omits the key — so a
value-only edit diffs and yields an honest `update`. (Only genuinely unresolvable shapes — an
endpoint ref, or a `connectorRef` with no live id yet — degrade to a mechanism-only entry, per
env var, so they cannot forever-diff.)

Two stale in-repo comments still describe the OLD behaviour and are escalated rather than edited
(both outside this audit's editable set): this sample's own `manifest.yaml` header, which presents
the lifted `checkEnvSupport` restriction as current — ledger escalation **E20** — and
`registry-services-writer.ts`'s "COMPARABLE LIMITATION" block, which still says env vars are
compared by NAME only and that a value-only change produces no diff — **E22**.

## Trigger is pinned to this sample's own channel

The trigger is pinned to this manifest's own `hosted-services-api` HTTP channel account via
`trigger.config.accountIds: [{channelRef: hosted-services-api}]` — the plural `accountIds` array
substitution (`ARRAY_SUBSTITUTION_ALLOWLIST`). No other HTTP-triggered workflow fires on this
instance's traffic.

## Prerequisites

- A running dev cluster with a provisioned tenant (`acme` by default).
- A Telegram bot account already provisioned — see
  [`telegram-transform-reply`](../../channels/telegram-transform-reply)'s own README.
- The `yoizen` CLI (`cd sdk && bun link`, or `cd sdk && bun run bin/yoizen.ts ...`).
- CLI environment: `YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
  `YOIZEN_PASSWORD` — same as every other sample.
- No secret bindings — this manifest declares no `secrets:` section (no credential-bearing
  fields).

## Provision (declarative)

```bash
cd sdk && bun link   # one-time; or prefix each call with `bun run bin/yoizen.ts`

yoizen manifests validate -f ../integrations/http/hosted-services-api/manifest.yaml
yoizen manifests plan     -f ../integrations/http/hosted-services-api/manifest.yaml
yoizen manifests apply    -f ../integrations/http/hosted-services-api/manifest.yaml --secrets-from-env
```

A second `apply` is a no-op once converged.

## Configure (Telegram recipient)

The Telegram chat id is a `systemVariables` entry (`hosted-services-api-chat-id`), not an env var —
edit `spec.systemVariables[0].value` in `manifest.yaml` to your real numeric chat id, then re-apply
(`plan` shows an `update` verdict for the system variable only):

```bash
yoizen manifests apply -f ../integrations/http/hosted-services-api/manifest.yaml --secrets-from-env
```

The workflow reads it at RUNTIME via `{{variables.system.hosted-services-api-chat-id}}` — changing
the recipient is a variable-value re-apply, never a workflow edit (same pattern as
`integrations/ai/ai-system-variables`).

## Run / exercise

```bash
cd integrations/http/hosted-services-api
./run.sh
```

`run.sh` (`src/index.ts`) is read-only: it verifies the service, route, and workflow exist, waits
for the gateway's dynamic-route cache (~15s), invokes `/samples/hosted-echo/health` directly, and —
if the workflow + HTTP account are present — POSTs a test message through the workflow. Telegram
messages from this sample start with:

```text
HOSTED SERVICE SAMPLE
```

That marker differentiates it from `http-fanout-telegram`, even if both send to the same chat.

## Environment (run.sh overrides only — provisioning is manifest-driven)

| Var | Default | Notes |
| --- | --- | --- |
| `HOSTED_SERVICE_NAME` | `sample-echo` | Must match `manifest.yaml`'s service name if overridden |
| `HOSTED_ROUTE_PREFIX` | `/samples/hosted-echo` | Must match `manifest.yaml`'s route `pathPrefix` |
| `HOSTED_ROUTE_CACHE_WAIT_SECONDS` | `16` | Gateway dynamic-route cache refresh wait |
| `HOSTED_WORKFLOW_NAME` | `hosted-service-telegram` | Must match `manifest.yaml`'s workflow name |
| `HOSTED_HTTP_EXTERNAL_ID` | `manifest:hosted-services-api` | The apply engine's derived externalId (`manifest:<channel name>`) |
| `RUN_TEXT` | `hello hosted service workflow` | Test message text |

## Troubleshooting

- **The gateway excludes platform-owned paths** from dynamic routing — `PLATFORM_PREFIXES` in
  `services/api-gateway/src/hooks/proxy.hook.ts` currently lists `/api/audit`, `/api/tenants`,
  `/api/registry`, `/api/connectors`, `/api/channels`, `/api/webhooks`, `/api/workflows`,
  `/api/proxy`, `/api/auth`, `/api/dashboard`, `/api/admin`, `/api/runtime` and `/health`. This is
  why the route uses `/samples/hosted-echo`, a non-platform prefix.
- **Dynamic routes are discovered by the gateway on a polling cache** — `DynamicRouteCacheService`'s
  `POLL_INTERVAL_MS` is 15 s, hence the sample's 16 s default wait after `apply`.
- **`registry-service` hardcodes a `/health` readiness probe and `runAsUser: 1001`** — your image
  must support both, or the route may return `502` while the Knative Service is not ready.
- **Need a real env var on your own hosted service?** Declare it — `env: [{ name, value }]` with a
  plain string, or `{ secretRef }` for a credential (see § Historical note); the worked example is
  `../../ai/ai-call-center-supervisor/manifest.yaml`.
