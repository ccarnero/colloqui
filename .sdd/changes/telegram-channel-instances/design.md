# Design: telegram-channel-instances

## Scope

Sample-only. Three gaps in `sdk/samples/telegram-transform-reply/setup.sh` and one in `README.md`.
No service-layer changes.

---

## Data flow: before vs. after

### Gap 1 — `stage_register_webhook` uses a non-instance URL

**Before**
```
Telegram setWebhook → <TG_PUBLIC_URL>/api/webhooks/telegram/<tenant>
                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                      dispatches to ANY active Telegram account for the tenant
```

**After**
```
Telegram setWebhook → <TG_PUBLIC_URL>/api/webhooks/telegram/<tenant>/<externalId>
                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                      routes to THIS bot's account instance only
```

The gateway already supports the `/<externalId>` segment; the entire infrastructure path
(gateway → channel-service ingest → NATS → consumer) is instance-aware. The sample was simply
not passing the segment.

### Gap 2 — `stage_simulate_inbound` posts to the non-instance URL

Same problem as Gap 1, for the synthetic inbound curl. The route exists; the URL was wrong.

**Before**
```
curl POST ${API_URL}/api/webhooks/telegram/${TENANT}
```

**After**
```
curl POST ${API_URL}/api/webhooks/telegram/${TENANT}/${EXTERNAL_ID}
```

### Gap 3 — workflow trigger has no `accountIds` pin

**Before**
```
trigger.config = { channels: ["telegram"], providers: ["telegram"] }
→ ANY telegram message on the tenant fires this workflow
```

**After (TG_PIN=1, the default)**
```
trigger.config = { channels: ["telegram"], providers: ["telegram"], accountIds: ["<account-id>"] }
→ ONLY messages to THIS bot's account instance fire the workflow
```

This mirrors exactly what `http-fanout-telegram` does for its HTTP channel instance (`FANOUT_PIN`).

---

## How `EXTERNAL_ID` is captured

The variable `EXTERNAL_ID` is promoted from a block-local to a script-level global (initialized
alongside `ACCOUNT_ID`).

### Reuse path

The existing query fetches the matching account list and extracts `.id`. The same JSON response
already contains `.externalId`; a second extraction is added:

```bash
# Current (extracts id only)
existing="$(api GET "/api/channels/accounts?channel=telegram" \
  | jq -r --arg p "$EXTERNAL_PREFIX" \
      '[.[] | select((.externalId // "") | startswith($p)) | select(.isActive)] | .[0].id // empty')"

# After — store the list, extract both fields
local accounts
accounts="$(api GET "/api/channels/accounts?channel=telegram")"

ACCOUNT_ID="$(echo "$accounts" | jq -r --arg p "$EXTERNAL_PREFIX" \
  '[.[] | select((.externalId // "") | startswith($p)) | select(.isActive)] | .[0].id // empty')"

EXTERNAL_ID="$(echo "$accounts" | jq -r --arg p "$EXTERNAL_PREFIX" \
  '[.[] | select((.externalId // "") | startswith($p)) | select(.isActive)] | .[0].externalId // empty')"
```

This avoids a second API call and matches the pattern used by `http-fanout-telegram`'s
`ensure_http_account` (which captures `HTTP_ACCOUNT_ID` and `HTTP_APP_SECRET` from the same
`$accounts` variable).

### Create path

The block-local `local external_id` is replaced by the global `EXTERNAL_ID`:

```bash
# Before
local external_id="${EXTERNAL_PREFIX}-$(date +%s)-${RANDOM}"
# ... used as $external_id throughout the block

# After
EXTERNAL_ID="${EXTERNAL_PREFIX}-$(date +%s)-${RANDOM}"
# ... used as $EXTERNAL_ID throughout the block (same suffix strategy, same uniqueness guarantee)
```

---

## Exact before/after snippets

### `stage_register_webhook` — line 250

```bash
# BEFORE
local path="/api/webhooks/telegram/${TENANT}"

# AFTER
local path="/api/webhooks/telegram/${TENANT}/${EXTERNAL_ID}"
```

The inline help text (the `log` lines that print the manual curl command when `TG_PUBLIC_URL` is
not set) must also be updated to use `${path}` (already interpolated), so no extra change needed
there — it references `$path` which will automatically include the instance segment.

### `stage_simulate_inbound` — lines 318, 320–324

```bash
# BEFORE (log line + curl)
log "POST /api/webhooks/telegram/${TENANT}  (chat_id=${chat_id}, text='hello ${nonce}')"
...
resp="$(curl -s -X POST "${API_URL}/api/webhooks/telegram/${TENANT}" \

# AFTER
log "POST /api/webhooks/telegram/${TENANT}/${EXTERNAL_ID}  (chat_id=${chat_id}, text='hello ${nonce}')"
...
resp="$(curl -s -X POST "${API_URL}/api/webhooks/telegram/${TENANT}/${EXTERNAL_ID}" \
```

### `stage_ensure_workflow` — workflow trigger (lines 234–239)

New env var added at the top of the config block (alongside `SIMULATE_INBOUND`):

```bash
# Pin the trigger to this Telegram instance via accountIds.
# ON by default: only messages resolved to this account fire the workflow.
# Set TG_PIN=0 to let ANY telegram message trigger it.
TG_PIN="${TG_PIN:-1}"
```

The `jq` call gains two new arguments and the trigger config uses conditional merge:

```bash
# BEFORE
body="$(jq -n \
  --arg name "$WORKFLOW_NAME" \
  --arg app  "$APPLICATION" \
  --arg code "$js_code" \
  '{
    ...
    trigger: {
      type: "message_received",
      mode: "shared",
      config: { channels: ["telegram"], providers: ["telegram"] }
    }
  }')"

# AFTER
body="$(jq -n \
  --arg name      "$WORKFLOW_NAME" \
  --arg app       "$APPLICATION" \
  --arg code      "$js_code" \
  --arg accountId "$ACCOUNT_ID" \
  --arg pin       "$TG_PIN" \
  '{
    ...
    trigger: {
      type: "message_received",
      mode: "shared",
      config: (
        { channels: ["telegram"], providers: ["telegram"] }
        + (if $pin == "1" then { accountIds: [$accountId] } else {} end)
      )
    }
  }')"
```

Note: on the RECREATE path, `stage_ensure_workflow` is already called after
`stage_ensure_account`, so `ACCOUNT_ID` is always populated when the body is built. No ordering
change needed.

---

## Backward compatibility

The non-instance URL `/api/webhooks/telegram/<tenant>` (without `/<externalId>`) continues to
work in the gateway. Existing bots whose `setWebhook` was registered against the tenant-level URL
are unaffected — they keep receiving. This change only makes the sample register at the
more-specific instance URL going forward.

Existing workflows without `accountIds` also continue firing on all telegram messages; pinning is
only applied to newly created (or recreated) workflow instances.

---

## README changes required

1. **Architecture diagram** (line 8): replace `/api/webhooks/telegram/<tenant>` with
   `/api/webhooks/telegram/<tenant>/<externalId>`.

2. **"What `setup.sh` creates"** item 3 (line 33–34): update the URL mentioned for
   `TG_PUBLIC_URL` webhook registration.

3. **Configuration table** (line 84–93): add row for `TG_PIN` (default `1`).

4. **Troubleshooting — wrong URL** (lines 138–148): update the manual `setWebhook` curl example
   to include the externalId segment, and update the `getWebhookInfo` note.

5. **Troubleshooting — no send event** (lines 159–164): the note that says
   `trigger.config should be just {channels:["telegram"], providers:["telegram"]} — no accountIds`
   is now wrong. Replace it with the inverted expectation: `trigger.config should include
   accountIds: ["<account-id>"]` when `TG_PIN=1` (the default), and explain that a stale workflow
   pinned to an old account id (after recreate) is the failure mode to watch for.
