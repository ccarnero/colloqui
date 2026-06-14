# Artifacts

Provisioning scripts that set up the **platform side** of the http-bridge sample.

The bridge app (`../server.js`) *sends* messages into the platform's http channel. These
artifacts create the platform resources that *react* to those messages — so you can wire the
two together end to end.

## create-workflow.sh

Creates a workflow that triggers on any message arriving via the **http channel** and runs an
inline JS step that appends `-received` to the message text.

```
message on http channel ──► trigger (message_received, channels:["http"]) ──► jsFunction: text + "-received"
```

### Run

```bash
cd sdk/samples/http-bridge/artifacts
./create-workflow.sh
# ==> Created workflow: <id>
```

Requires `curl` and `jq`, and a reachable platform (defaults to the dev cluster).
Override any of these (same `YOIZEN_*` vars the bridge uses):

| Env var | Default |
| --- | --- |
| `YOIZEN_BASE_URL` | `http://api-gateway.platform-services-dev.dev.local` |
| `YOIZEN_TENANT` | `acme` |
| `YOIZEN_EMAIL` | `yclawd@demo.io` (dev seed admin) |
| `YOIZEN_PASSWORD` | `admin123` |

The script is idempotent — if the workflow already exists it prints the id and exits.

## Binding the bridge to this workflow (end to end)

1. Create the workflow: `./create-workflow.sh`.
2. Make sure an **active http channel account** exists for the tenant (the SDK/bridge resolves
   its `appSecret` to send; create one via the admin console or the platform API). Without it,
   inbound messages have nothing to authenticate against.
3. Run the bridge and send a message:
   ```bash
   cd ..               # sdk/samples/http-bridge
   pnpm install && YOIZEN_TENANT=acme YOIZEN_EMAIL=… YOIZEN_PASSWORD=… pnpm start
   curl -X POST localhost:4000/messages -H 'content-type: application/json' \
     -d '{"from":"customer@example.com","text":"hello"}'
   ```
4. The message lands on the http channel → the workflow fires → `appendReceived` produces
   `"hello-received"`.

### Where to see the result

The http channel is **ingest-only**, so the workflow can't send the transformed string back
over http. Observe it instead via:

- **Execution API** — list executions for the workflow, then read the latest one's result:
  ```bash
  # WF=<id from create-workflow.sh>, TOKEN=<from a login>
  curl -s "$YOIZEN_BASE_URL/api/workflows/$WF/executions" \
    -H "x-yoizen-tenant: $YOIZEN_TENANT" -H "Authorization: Bearer $TOKEN" | jq '.'
  ```
  The `appendReceived` result is `"<text>-received"`.
- **Worker logs** — the step also logs `[http-bridge-wf] <from> -> <text>-received`.
