# Tasks: telegram-channel-instances

All changes are in `sdk/samples/telegram-transform-reply/`. No service changes.

---

## Task 1 — Promote `EXTERNAL_ID` to script-level global and capture it on reuse

**File**: `sdk/samples/telegram-transform-reply/setup.sh`

**What**:
1. Add `EXTERNAL_ID=""` to the script-level globals block (alongside `TOKEN`, `ACCOUNT_ID`, etc.,
   around line 82).
2. In `stage_ensure_account`, on the **reuse path** (lines 133–144):
   - Store the full API response in a local `accounts` variable instead of piping directly into jq.
   - Extract `ACCOUNT_ID` from `$accounts` (same logic, now using the stored variable).
   - Add a second extraction for `EXTERNAL_ID` from `$accounts` using `.[0].externalId // empty`.
3. In `stage_ensure_account`, on the **create path** (line 160):
   - Change `local external_id="${EXTERNAL_PREFIX}-$(date +%s)-${RANDOM}"` to
     `EXTERNAL_ID="${EXTERNAL_PREFIX}-$(date +%s)-${RANDOM}"`.
   - Update all references in the create block from `$external_id` to `$EXTERNAL_ID`.

**Acceptance check**:
```bash
# Run setup.sh in reuse mode; confirm EXTERNAL_ID is logged
TG_RECREATE=0 ./setup.sh 2>&1 | grep "externalId="
# should print the actual externalId, not empty

# Run setup.sh with TG_RECREATE=1; confirm a new EXTERNAL_ID is generated
TG_RECREATE=1 TELEGRAM_BOT_TOKEN=placeholder ./setup.sh 2>&1 | grep "externalId="
```

---

## Task 2 — Fix `stage_register_webhook` to use the instance URL

**File**: `sdk/samples/telegram-transform-reply/setup.sh`

**Line**: 250

**What**:
Change:
```bash
local path="/api/webhooks/telegram/${TENANT}"
```
to:
```bash
local path="/api/webhooks/telegram/${TENANT}/${EXTERNAL_ID}"
```

No other changes needed in this function: the `log` fallback lines already interpolate `${path}`,
so the printed manual curl command automatically picks up the instance segment.

**Acceptance check**:
```bash
# Dry-run: confirm the printed manual curl includes the externalId segment
TG_RECREATE=0 ./setup.sh 2>&1 | grep "setWebhook\|webhooks/telegram"
# Expected: ...webhooks/telegram/acme/<externalId suffix>

# With a real tunnel + token: getWebhookInfo should show the instance URL
curl -s "https://api.telegram.org/bot<token>/getWebhookInfo" | jq '.result.url'
# Expected: "https://<tunnel>/api/webhooks/telegram/acme/<externalId>"
```

---

## Task 3 — Fix `stage_simulate_inbound` to use the instance URL

**File**: `sdk/samples/telegram-transform-reply/setup.sh`

**Lines**: 318, 320–321

**What**:
Change the log line (line 318) from:
```bash
log "POST /api/webhooks/telegram/${TENANT}  (chat_id=..."
```
to:
```bash
log "POST /api/webhooks/telegram/${TENANT}/${EXTERNAL_ID}  (chat_id=..."
```

Change the curl target (lines 320–321) from:
```bash
resp="$(curl -s -X POST "${API_URL}/api/webhooks/telegram/${TENANT}" \
```
to:
```bash
resp="$(curl -s -X POST "${API_URL}/api/webhooks/telegram/${TENANT}/${EXTERNAL_ID}" \
```

**Acceptance check**:
```bash
SIMULATE_INBOUND=1 TELEGRAM_TEST_CHAT_ID=987654321 \
  TELEGRAM_BOT_TOKEN=placeholder ./setup.sh 2>&1 | grep "POST /api/webhooks"
# Expected line: POST /api/webhooks/telegram/acme/<externalId>

# The response should be {"status":"accepted"}, not 404
# (requires a running cluster)
```

---

## Task 4 — Add `TG_PIN` env var and `accountIds` to the workflow trigger

**File**: `sdk/samples/telegram-transform-reply/setup.sh`

**What**:
1. Add the `TG_PIN` env var to the config block (alongside `SIMULATE_INBOUND`, around line 70):
   ```bash
   # Pin the trigger to this Telegram instance via accountIds.
   # ON by default: only messages resolved to this account fire the workflow.
   # Set TG_PIN=0 to let ANY telegram message trigger it.
   TG_PIN="${TG_PIN:-1}"
   ```

2. In `stage_ensure_workflow`, extend the `jq` call (currently around line 213) with two new
   arguments:
   ```bash
   --arg accountId "$ACCOUNT_ID" \
   --arg pin       "$TG_PIN" \
   ```

3. Change the `trigger.config` block from:
   ```json
   config: { channels: ["telegram"], providers: ["telegram"] }
   ```
   to:
   ```json
   config: (
     { channels: ["telegram"], providers: ["telegram"] }
     + (if $pin == "1" then { accountIds: [$accountId] } else {} end)
   )
   ```

This change applies to both the initial create path and the RECREATE path (they share the same
`jq` call). `ACCOUNT_ID` is always set before `stage_ensure_workflow` runs.

**Acceptance check**:
```bash
# After running setup.sh, inspect the created workflow trigger
TG_RECREATE=1 TELEGRAM_BOT_TOKEN=placeholder ./setup.sh 2>&1
# Then query the API:
curl -s -H "Authorization: Bearer <TOKEN>" \
  -H "x-yoizen-tenant: acme" \
  http://localhost:8080/api/workflows | \
  jq '.[] | select(.name=="telegram-transform-reply") | .trigger.config'
# Expected with TG_PIN=1: {"channels":["telegram"],"providers":["telegram"],"accountIds":["<uuid>"]}
# Expected with TG_PIN=0: {"channels":["telegram"],"providers":["telegram"]}
```

---

## Task 5 — Update README

**File**: `sdk/samples/telegram-transform-reply/README.md`

**What**:

1. **Architecture diagram** (line 8): update the URL to include the instance segment:
   ```
   Telegram msg ──► api-gateway (/api/webhooks/telegram/<tenant>/<externalId>)
   ```

2. **"What `setup.sh` creates"**, item 3 (lines 33–34): mention that the webhook is registered
   at the instance URL, not the tenant-level URL. The description should note that `externalId`
   is the instance segment.

3. **Configuration table** (lines 84–93): add row:
   ```
   | `TG_PIN` | `1` | `1` pins the workflow trigger to this bot's account via `accountIds`. `0` lets any telegram message on the tenant fire the workflow. |
   ```

4. **Troubleshooting — wrong URL** (lines 138–148): update the manual `setWebhook` curl example
   to include the externalId segment:
   ```bash
   curl -s "https://api.telegram.org/bot<token>/setWebhook" \
     --data-urlencode "url=https://api.devmachina.net/api/webhooks/telegram/acme/<externalId>" \
     --data-urlencode "secret_token=$(cat .telegram-sample-secret)"
   ```
   Also update the prose and the `getWebhookInfo` note to say the URL should end in
   `/api/webhooks/telegram/<tenant>/<externalId>`.

5. **Troubleshooting — no send event** (lines 159–164): invert the expectation. Replace the note
   that says "trigger.config should be just {channels, providers} — no accountIds" with:
   ```
   With TG_PIN=1 (the default), trigger.config should include accountIds: ["<account-id>"].
   If it does not, or if the id is stale (from a previous account before TG_RECREATE=1), the
   matcher silently skips it. Fix: run with TG_RECREATE=1 to rebuild both account and workflow.
   ```

**Acceptance check**:
- All URLs in the README that reference `/api/webhooks/telegram/<tenant>` include the
  `/<externalId>` segment or explicitly note it as optional (tenant-level fallback).
- `TG_PIN` appears in the configuration table.
- The troubleshooting section no longer tells the reader to expect "no accountIds".

---

## Task 6 — Manual E2E verification

This task has no code changes. It is the acceptance gate for all previous tasks.

**Steps**:

1. Provision from scratch:
   ```bash
   cd sdk/samples/telegram-transform-reply
   TELEGRAM_BOT_TOKEN="<real-token>" \
   TG_PUBLIC_URL="https://api.devmachina.net" \
   TG_API_URL="http://localhost:8080" \
   TG_HOST_HEADER="api-gateway.platform-services-dev.127.0.0.1.sslip.io" \
   TG_RECREATE=1 \
   ./setup.sh
   ```

2. Verify webhook registration:
   ```bash
   curl -s "https://api.telegram.org/bot<token>/getWebhookInfo" | jq '.result.url'
   # Must end in /api/webhooks/telegram/acme/<externalId>
   ```

3. Verify workflow trigger:
   ```bash
   # (use the auth helper from README)
   auth "$GW/api/workflows" | \
     jq '.[] | select(.name=="telegram-transform-reply") | .trigger.config'
   # Must contain accountIds: ["<uuid>"]
   ```

4. Simulate inbound and verify it is accepted at the instance URL:
   ```bash
   SIMULATE_INBOUND=1 TELEGRAM_TEST_CHAT_ID="<your-chat-id>" \
   TELEGRAM_BOT_TOKEN="<real-token>" \
   TG_API_URL="http://localhost:8080" \
   TG_HOST_HEADER="api-gateway.platform-services-dev.127.0.0.1.sslip.io" \
   ./setup.sh
   # Output: inbound accepted; workflow execution observed
   ```

5. Real inbound: message the bot directly from Telegram. Expect a reply:
   `Echo: <your text> — processed at <ISO ms> (epoch_ms=...)`.

6. Cross-fire check (optional): if a second Telegram account exists on the tenant,
   send a message to it and confirm the `telegram-transform-reply` workflow does NOT fire
   (check workflow executions count before/after).
