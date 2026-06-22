# ADR: telegram-channel-instances sample fixes

## Context

The `telegram-transform-reply` sample provisions a Telegram bot as a channel account, registers
a webhook with Telegram, and creates a workflow that transforms and replies to inbound messages.

The infrastructure (gateway, channel-service ingest, NATS consumer) already supports per-instance
Telegram webhook URLs of the form `/api/webhooks/telegram/<tenant>/<externalId>`, routing inbound
events to the specific account whose `externalId` matches the path segment.

Three gaps existed in the sample setup script:
- The webhook was registered at the tenant-level URL (no instance segment), so any bot on the
  tenant would receive traffic meant for this bot.
- The simulate-inbound stage posted to the same non-instance URL.
- The workflow trigger had no `accountIds` pin, so any Telegram message on the tenant would fire
  the workflow — including messages from other bots or future integrations.

---

## Decision 1: use `externalId` as the instance URL segment

**Decision**: The instance segment of the webhook URL is the account's `externalId`, not its
database `id` (UUID).

**Rationale**: The gateway route is keyed by `externalId` (the channel-service ingest path
resolves the account by `channel + externalId`). Using the database `id` would require a
different lookup path and would couple the URL to an opaque internal identifier. The `externalId`
is stable per-account, human-readable, and already used as the primary external routing key
across all channel types. The HTTP channel sample (`http-fanout-telegram`) follows the same
pattern: `HTTP_EXTERNAL_ID` is the instance segment of `/api/webhooks/http/<tenant>/<externalId>`.

**Consequences**:
- The `externalId` must be captured as a script-level global (not a block-local) so both
  `stage_register_webhook` and `stage_simulate_inbound` can reference it.
- On account reuse, the `externalId` is read back from the list API response alongside the `id`.
- On account create, the generated value `${EXTERNAL_PREFIX}-$(date +%s)-${RANDOM}` is assigned
  to the global `EXTERNAL_ID`.

**Alternatives rejected**:
- _Use the database `id` (UUID)_: the gateway doesn't route by `id`; it routes by `externalId`.
  This would require a separate lookup or a gateway change.
- _Use a static `EXTERNAL_ID` (no random suffix)_: the script already appends a unique suffix on
  create to avoid the `(channel, external_id)` unique key constraint in dev environments where
  delete doesn't free the slot. Keeping the suffix strategy is correct; the global `EXTERNAL_ID`
  is simply the value produced by that strategy.

---

## Decision 2: `accountIds` pinning ON by default, with `TG_PIN` opt-out

**Decision**: The workflow trigger includes `accountIds: [<account-id>]` when `TG_PIN=1` (the
default). Set `TG_PIN=0` to disable pinning and allow any Telegram message on the tenant to fire
the workflow.

**Rationale**: Without pinning, any tenant-level Telegram message fires the workflow regardless
of which bot received it. This is safe for a single-bot tenant but silently cross-fires in
multi-bot setups. Pinning by default is the safer and more instructive default for a sample that
is meant to demonstrate isolated channel instance behavior. The HTTP fanout sample (`FANOUT_PIN`,
default `1`) established this pattern — the Telegram sample mirrors it for consistency.

**Consequences**:
- After `TG_RECREATE=1`, the old account is deleted and a new one is created with a new `id`.
  The workflow is also recreated (the script already deletes + recreates both together), so the
  new `ACCOUNT_ID` is always used when the workflow body is built. No stale-pin risk.
- The README troubleshooting section that previously advised "no accountIds in trigger.config"
  must be inverted: the expected state is now `accountIds: ["<account-id>"]` with `TG_PIN=1`.

**Alternatives rejected**:
- _Pin OFF by default_: consistent with the original behavior but teaches the wrong pattern and
  causes cross-firing in multi-bot tenants.
- _Always pin, no opt-out_: removes flexibility for single-bot tenants that want simpler config
  and matches no established pattern in the samples.

---

## Decision 3: no service-layer changes — sample scope only

**Decision**: All three fixes are confined to `sdk/samples/telegram-transform-reply/setup.sh`
and `sdk/samples/telegram-transform-reply/README.md`. No changes to gateway routes, channel-service,
workflow-service, shared packages, or any other sample.

**Rationale**: The exploration confirmed that every service already handles the instance URL and
`accountIds` filter generically. The gaps are purely in how the sample configures those features,
not in whether the features exist.

**Consequences**: Zero migration risk, zero backward compat concern for running services.
Existing tenant-level webhook registrations continue to work.
