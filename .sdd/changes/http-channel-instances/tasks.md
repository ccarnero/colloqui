# Tasks — http-channel-instances

Ordered by dependency: correctness invariant first (consumer), then the sample
default, then the console UX, then end-to-end verification.

## 1. Verify + guard `instance` forwarding in the NATS consumer

- **File:** `services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts`
- **Change:** No production change expected — confirm `processMessage` passes
  `envelope.data?.instance` as the final argument to `processEnvelope`
  (currently line 154). If it is missing, add it.
- **Also add:** a unit/integration test asserting that when the envelope carries
  `data.instance`, `WebhookIngressService.processEnvelope` is called with that
  value as the last argument (mock `WebhookIngressService`, feed a `JsMsg` with a
  valid base64 body and `data.instance` set).
- **Verify:** `bun test` (or the channel-service Vitest target) — the new test
  passes; existing webhook-ingress tests stay green.

## 2. Flip `FANOUT_PIN` default to 1 in the sample

- **File:** `sdk/samples/http-fanout-telegram/setup.sh` (line 89, comment 84-88)
- **Change:**
  - `FANOUT_PIN="${FANOUT_PIN:-0}"` → `FANOUT_PIN="${FANOUT_PIN:-1}"`
  - Update the Spanish comment to say the pin is ON by default after the
    per-instance redeploy, and `FANOUT_PIN=0` is the opt-out for the
    single-HTTP-workflow case.
- **Verify:** `bash -n sdk/samples/http-fanout-telegram/setup.sh` (syntax ok);
  `FANOUT_PIN` unset → resolves to `1`; `FANOUT_PIN=0 ...` → still `0`.

## 3. Render the real `appSecret` in the curl snippet

- **File:** `services/admin-console/src/app/features/channels/channels.component.ts`
  (`ingestCurlFor`, lines 300-307)
- **Change:** Introduce `const token = account.appSecret ?? "<app-secret>";` and
  interpolate it into the `x-http-channel-token` header instead of the literal
  `<app-secret>`.
- **Note:** No model or service change needed — `IChannelAccount.appSecret`
  already exists and the `list` endpoint already returns it unredacted.
- **Verify:** `bun run build` / `ng build` for admin-console compiles; in the
  Channels page (channel = http) the rendered curl shows the account's real
  token; an account without a secret still shows `<app-secret>`.

## 4. End-to-end verification

- **Goal:** Confirm a message to a pinned HTTP instance fires only that
  instance's workflow.
- **Steps:**
  1. Run the sample with the new default (pin ON):
     `bash sdk/samples/http-fanout-telegram/setup.sh`
  2. Copy the token from the console curl snippet (or `HTTP_APP_SECRET` printed
     by setup) and POST to the per-instance URL:
     ```sh
     curl -X POST \
       "$BASE/api/webhooks/http/$TENANT/http-fanout-telegram" \
       -H 'content-type: application/json' \
       -H "x-http-channel-token: $HTTP_APP_SECRET" \
       -d '{"from":"customer@example.com","text":"hello"}'
     ```
  3. Confirm the fanout workflow fires and the Telegram message arrives.
  4. POST a generic HTTP message to a DIFFERENT instance/token and confirm the
     pinned workflow does NOT fire (instance isolation holds).
- **Verify:** Step 3 succeeds; step 4 shows no cross-firing.
