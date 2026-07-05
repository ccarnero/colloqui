# http-connectors

Declarative **outbound HTTP connectors** for the platform. Each connector wraps a well-known
public developer API as a platform *adapter*, so a workflow can call it with an `endpointCall`
action instead of hard-coding URLs and credentials. This is the outbound counterpart to the
[`http-bridge`](../http-bridge) sample (which pushes messages *into* the platform).

A single idempotent [`setup.sh`](./setup.sh) reads the JSON files in [`connectors/`](./connectors)
and **upserts** each one through the platform API: it creates the connector if it's missing (or
reuses the existing one), `PATCH`es its declarative config (currently just `defaultCache`, when the
config file declares one) so an existing connector picks up config changes on re-run, then
reconciles its endpoints — adding any `(method, path)` declared in the config that isn't registered
yet, leaving the rest untouched. So you can enrich a config with new endpoints or cache settings,
re-run, and only the drift gets applied.

## What gets created

Four no-auth connectors and one Basic-auth connector. Each declares an endpoint for every method
the underlying API supports — `jsonplaceholder` and `httpbin` cover full `GET/POST/PUT/PATCH/DELETE`;
the read-only APIs (`pokeapi`, `catfacts`, basic-auth) cover `GET` resources.

| Connector | Auth | Base URL | Methods | Endpoints |
| --- | --- | --- | --- | --- |
| `jsonplaceholder` | none | `https://jsonplaceholder.typicode.com` | GET, POST, PUT, PATCH, DELETE | `GET /posts`, `GET /posts/1`, `POST /posts`, `PUT /posts/1`, `PATCH /posts/1`, `DELETE /posts/1`, `GET /posts/1/comments`, `GET /todos/1`, `GET /users/1` |
| `httpbin` | none | `https://httpbin.org` | GET, POST, PUT, PATCH, DELETE | `GET /get`, `POST /post`, `PUT /put`, `PATCH /patch`, `DELETE /delete`, `GET /uuid`, `GET /headers`, `GET /ip`, `GET /user-agent`, `GET /json`, `GET /status/200` |
| `pokeapi` | none | `https://pokeapi.co` | GET | `GET /api/v2/pokemon/ditto`, `GET /api/v2/pokemon`, `GET /api/v2/ability/limber`, `GET /api/v2/type/water`, `GET /api/v2/move/tackle`, `GET /api/v2/generation/generation-i` |
| `catfacts` | none | `https://catfact.ninja` | GET | `GET /fact`, `GET /facts`, `GET /breeds` |
| `httpbin-basic-auth` | basic | `https://httpbin.org` | GET | `GET /basic-auth/user/passwd`, `GET /hidden-basic-auth/user/passwd` |

Each file in `connectors/` is a complete [`CreateAdapterDto`](../../../services/connector-admin/src/modules/adapters/adapters.dto.ts):
`name`, `context` (`external`), `baseUrl`, `authType`, `authConfig`, `endpoints[]` (each with a
descriptive `label`, `method`, and `path`), plus timeouts and retries. Endpoint uniqueness is
`(method, path)` per connector, so `GET /post` and `POST /post` are distinct. To add another
connector, drop a new JSON file in `connectors/` — `setup.sh` picks it up automatically; to add an
endpoint, add it to the relevant file and re-run.

`catfacts` also declares a `defaultCache` block: `enabled: true`, `ttlSeconds: 300`, `methods:
["GET", "HEAD"]`, `keyQueryParams: "all"` — so `GET /fact` / `/facts` / `/breeds` responses are
cached for 300 seconds. `setup.sh` `PATCH`es `defaultCache` onto the connector on every run
(including re-runs against an already-provisioned connector), so editing the cache settings in
`catfacts.json` and re-running `./setup.sh` is enough to apply the change — no `RECREATE=1` needed.

## Run

```bash
cd sdk/samples/http-connectors
./setup.sh
# [STEP]  0/3 preflight
# [STEP]  2/3 upsert connectors from .../connectors
# [INFO]  create 'jsonplaceholder' (auth=none) -> id=...
# [INFO]      + GET /posts  (List all posts)
# [INFO]      + POST /posts  (Create a post)
# ...
# [INFO]  connectors: created=5  reused=0   endpoints added=31   failed=0
```

Requires Node >=18 and a reachable platform (defaults to the dev cluster) — provisioning is driven by
`@yoizen/platform-sdk` via `src/setup.ts` (`setup.sh` resolves the dev environment and execs it with
`npx tsx`); login itself is handled transparently by the SDK client on first request, which is why
the stage numbering skips straight from `0/3` to `2/3`. The script is a
**true upsert** — a second run prints `reuse '<name>' — exists` and `endpoints already up to date`,
creating nothing; but if you've added endpoints to a config since the last run, only those new
`(method, path)` pairs are added (`+ <METHOD> <path>`).

### Environment

`setup.sh` sources `../lib/resolve-env.sh` automatically, which loads a `.env` file from this
directory (if present) and detects the gateway endpoint. You can run the script standalone with no
extra setup — just place overrides in a `.env` file next to `setup.sh`.

| Env var | Default | Purpose |
| --- | --- | --- |
| `RECREATE` | `0` | `1` deletes all `context=external` connectors then reprovisions from scratch |
| `YOIZEN_BASE_URL` | auto-detected | Gateway base URL |
| `YOIZEN_HOST_HEADER` | auto-detected | `Host` header for the dev ingress |
| `YOIZEN_TENANT` | `acme` | Tenant id |
| `YOIZEN_EMAIL` | `yclawd@demo.io` | Login email (dev seed admin) |
| `YOIZEN_PASSWORD` | `admin123` | Login password |
| `HTTPBIN_BASIC_USER` | `user` | Basic-auth username for `httpbin-basic-auth` |
| `HTTPBIN_BASIC_PASS` | `passwd` | Basic-auth password for `httpbin-basic-auth` |

## How auth works

The platform resolves auth from the connector, not from the caller. For `authType: "basic"`,
[`applyAdapterAuthHeadersSync`](../../../packages/shared/src/adapter-auth-headers.ts) base64-encodes
`authConfig.basicUsername:authConfig.basicPassword` into an `Authorization: Basic …` header on every
request — the workflow never sees the credentials.

`httpbin`'s `/basic-auth/<user>/<passwd>` endpoint echoes the **expected** credentials in the URL
path, so the connector's `basicUsername`/`basicPassword` must match those path segments. The
defaults (`user`/`passwd`) work out of the box and return `200 {"authenticated": true}`. When you
override `HTTPBIN_BASIC_USER` / `HTTPBIN_BASIC_PASS`, `setup.sh` rewrites **both** the `authConfig`
and the basic-auth endpoint paths together, so they can't drift apart. Set only one of them (a
mismatch) to see httpbin return `401`.

> These are public sandbox APIs and the Basic credentials are intentionally public test values —
> there are no real secrets in this sample. Treat it as a template; for real connectors, source
> credentials from your secret store rather than committing them.

## Calling a connector from a workflow

Connectors are consumed by the `endpointCall` activity. The argument shape has three valid forms
(see [`EndpointCallArgs`](../../../packages/shared/src/workflow.interfaces.ts)):

1. **`adapterId` + `endpointId`** — fully adapter-resolved (method, path, headers, auth, timeouts
   all come from the connector). `url` is ignored.
2. **`adapterId` + `url` as a path** (e.g. `/posts/1`) — the connector's `baseUrl` is joined with
   `url`; connector headers/auth/timeouts still apply.
3. **No `adapterId`** — `url` must be absolute (`http(s)://…`); fixed 30 s timeout, no retries, no
   adapter auth.

Example action using a connector by id + ad-hoc path (form 2):

```json
{
  "name": "fetchPost",
  "activity": "endpointCall",
  "args": {
    "adapterId": "<jsonplaceholder-id>",
    "method": "GET",
    "url": "/posts/1"
  }
}
```

Get the connector ids with:

```bash
TOKEN=...   # from a login
curl -s "$YOIZEN_BASE_URL/api/connectors?context=external" \
  -H "Host: $YOIZEN_HOST_HEADER" -H "x-yoizen-tenant: $YOIZEN_TENANT" \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '.[] | "\(.name)\t\(.id)\t\(.authType)"'
```

## Manage connectors

The gateway exposes the full CRUD surface (all under the `api` global prefix):

| Method | Path | Action |
| --- | --- | --- |
| `POST` | `/api/connectors` | Create a connector |
| `GET` | `/api/connectors?context=external` | List connectors |
| `GET` | `/api/connectors/:id` | Get one (with endpoints) |
| `PATCH` | `/api/connectors/:id` | Update connector fields |
| `DELETE` | `/api/connectors/:id` | Delete a connector |
| `POST` | `/api/connectors/:id/endpoints` | Add an endpoint |
| `PATCH` / `DELETE` | `/api/connectors/:id/endpoints/:epId` | Update / remove an endpoint |

## Troubleshooting

- **`Login failed`** — check `YOIZEN_EMAIL` / `YOIZEN_PASSWORD` / `YOIZEN_TENANT` and that the
  gateway is reachable at `YOIZEN_BASE_URL`.
- **`create FAILED … "already exists"`** — not an error; it's logged as a reuse. The
  `(name, tenant)` pair is unique, so the connector is already provisioned.
- **`401` from `httpbin-basic-auth`** — the Basic credentials don't match the URL path segments.
  Re-run with matching `HTTPBIN_BASIC_USER` / `HTTPBIN_BASIC_PASS` (the script keeps them in sync).
- **Connector created but calls fail at runtime** — the public API must be reachable from inside
  the cluster (egress). The connector is provisioned regardless of whether the API is reachable
  from your laptop.
