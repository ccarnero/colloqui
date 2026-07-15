# hosted-services-api

Registers a tenant-scoped **hosted service** through the platform API, creates a dynamic route for
it, invokes that route through `api-gateway`, and optionally wires a workflow that calls the hosted
service and sends a Telegram notification.

```
POST /api/registry/services ─► registry-service ─► Knative Service
POST /api/registry/services/:id/routes ─► dynamic route discovery
GET  /samples/hosted-echo/... ─► api-gateway dynamic-route hook ─► Knative Service
HTTP webhook ─► workflow-service ─► serviceCall(sample-echo) ─► Telegram
```

## What it creates

- A registered service named `sample-echo` by default.
- A Knative Service in the tenant namespace.
- A dynamic route at `/samples/hosted-echo`.
- A public route by default, so the invoke call only needs tenant resolution headers.
- If `TELEGRAM_CHAT_ID` is set, a workflow named `hosted-service-telegram`.
- A dedicated HTTP channel instance with `externalId=hosted-services-api`, so this workflow does not
  cross-fire with `http-fanout-telegram`.

## Run

```bash
cd integrations/http/hosted-services-api
cp .env.example .env
./setup.sh
./run.sh
```

`setup.sh` is idempotent: it reuses the service by name, updates its desired runtime settings, and
reuses the matching route. If Telegram is configured, it also creates/updates the workflow and its
dedicated HTTP trigger account. Use `RECREATE=1 ./setup.sh` to rebuild the sample resources.

Telegram messages from this sample start with:

```text
HOSTED SERVICE SAMPLE
```

That marker intentionally differentiates it from `http-fanout-telegram`, even if both send to the
same Telegram chat.

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `HOSTED_SERVICE_NAME` | `sample-echo` | Lowercase DNS-ish service name |
| `HOSTED_SERVICE_IMAGE` | `ealen/echo-server:latest` | Must run as UID `1001` and serve `/health` |
| `HOSTED_SERVICE_PORT` | `8080` | Container port registered in Knative; Knative injects reserved `PORT` itself |
| `HOSTED_ROUTE_PREFIX` | `/samples/hosted-echo` | Must not start with reserved platform prefixes like `/api/registry` |
| `HOSTED_ROUTE_PUBLIC` | `true` | `false` makes dynamic route invocation require bearer auth |
| `HOSTED_ROUTE_STRIP_PREFIX` | `true` | Removes the route prefix before proxying upstream |
| `HOSTED_ROUTE_METHODS` | `GET,POST` | Comma-separated HTTP methods |
| `HOSTED_WORKFLOW_ENABLED` | `1` | Set `0` to skip workflow/Telegram setup |
| `HOSTED_WORKFLOW_NAME` | `hosted-service-telegram` | Workflow that invokes the hosted service |
| `HOSTED_HTTP_EXTERNAL_ID` | `hosted-services-api` | Dedicated HTTP trigger instance for this workflow |
| `TELEGRAM_CHAT_ID` | *(empty)* | Required only when `HOSTED_WORKFLOW_ENABLED=1`; numeric Telegram chat id |
| `TG_ACCOUNT_ID` | *(empty)* | Optional Telegram channel account id; otherwise the first active Telegram account is used |
| `RECREATE` | `0` | `1` deletes and recreates the service before route setup |

## Gotchas

- The gateway excludes platform-owned paths such as `/api/auth`, `/api/registry`, `/api/workflows`,
  `/api/webhooks`, and `/health` from dynamic routing. Use a non-platform prefix like
  `/samples/hosted-echo`.
- Dynamic routes are discovered by the gateway on a polling cache. Wait about 15 seconds after route
  creation before the first invoke.
- Do not set `PORT` in `envVars`. Knative reserves that variable and injects it from the container
  port; setting it manually is rejected by the admission webhook.
- `registry-service` currently hardcodes a readiness probe at `/health` and a non-root security
  context (`runAsUser: 1001`). Your image must support both, or the route may return `502` while the
  Knative Service is not ready.
- The workflow trigger is pinned to its own HTTP channel account by default (`HOSTED_WORKFLOW_PIN=1`).
  That is what prevents another HTTP workflow sample from handling this sample's test message.
