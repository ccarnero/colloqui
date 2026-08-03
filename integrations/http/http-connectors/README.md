# http-connectors

Declarative **outbound HTTP connectors** for the platform. Each connector wraps a well-known
public developer API as a platform *adapter*, so a workflow can call it with an `endpointCall`
action instead of hard-coding URLs and credentials. This is the outbound counterpart to the
[`sdk/examples/reference-pattern`](../../../sdk/examples/reference-pattern) sample (which pushes
messages *into* the platform). Provisioning is **declarative**: a single
[`manifest.yaml`](./manifest.yaml) applied through the `yoizen` CLI (no setup scripts).

```
manifest.yaml ─► yoizen manifests apply ─► connector-admin (5 connectors, 31 endpoints)

workflow endpointCall(adapterId, ...) ─► connector-runtime ─► the public API
```

`kind: LibraryManifest` — this manifest exists only to provision a shared connector catalog other
manifests/workflows reference; it declares no channel and no agent/workflow of its own. See the
manifest's own header comment for the structural-rule reasoning.

## What `manifest.yaml` provisions

Four no-auth connectors and one Basic-auth connector, each with every endpoint the underlying API
supports — 31 endpoints total.

| Connector | Auth | Base URL | Endpoints |
| --- | --- | --- | --- |
| `jsonplaceholder` | none | `https://jsonplaceholder.typicode.com` | 9 (full CRUD on `/posts` + `/todos`, `/users`, `/comments`) |
| `httpbin` | none | `https://httpbin.org` | 11 (`GET/POST/PUT/PATCH/DELETE`, `/uuid`, `/headers`, `/ip`, `/user-agent`, `/json`, `/status/200`) |
| `pokeapi` | none | `https://pokeapi.co` | 6 (read-only) |
| `catfacts` | none | `https://catfact.ninja` | 3 (read-only, cached — see below) |
| `httpbin-basic-auth` | basic | `https://httpbin.org` | 2 (`/basic-auth/...`, `/hidden-basic-auth/...`) |

> **EXISTING-STATE NOTE.** These 5 connectors already exist live (recreated 2026-07-16 via the
> now-deleted `setup.ts`). The manifest's names match the live connectors exactly, so `apply`
> reconciles them (update/noop) rather than duplicating.

## Secrets (Basic auth)

`httpbin-basic-auth` uses `auth.authType: basic` with two nested `secretRef` bindings — the
manifest never carries a literal credential:

| Binding name (= env var for `--secrets-from-env`) | Targets | Default to reproduce old behavior |
| --- | --- | --- |
| `httpbin-basic-auth-username` | `authConfig.basicUsername` | `user` |
| `httpbin-basic-auth-password` | `authConfig.basicPassword` | `passwd` |

These reproduce the deleted `setup.ts`'s `HTTPBIN_BASIC_USER`/`HTTPBIN_BASIC_PASS` defaults
byte-for-byte — `httpbin`'s `/basic-auth/<user>/<passwd>` endpoint echoes the **expected**
credentials in the URL path itself, and the two endpoint paths declared in `manifest.yaml`
(`/basic-auth/user/passwd`, `/hidden-basic-auth/user/passwd`) already hard-code those defaults.

**Limitation (documented, not silently dropped):** the deleted script dynamically rewrote both
the credentials and the endpoint paths together when you overrode them, so they could never drift
apart. A static manifest cannot do that — if you want different Basic credentials, you must edit
**both** the secret values below **and** the two endpoint `path` fields in `manifest.yaml` by hand
to keep them in sync. Setting only one (a real mismatch test) is still possible and behaves like
the original sample: httpbin returns `401`.

## Documented gap (connector-level `defaultCache` — NOT dropped, re-expressed)

The deleted `setup.ts` PATCHed a **connector-level** `defaultCache` onto `catfacts`
(`client.connectors.update(id, { defaultCache })`, mapped to connector-admin's own
`default_cache_strategy` column). Manifest v1's `connectorSchema` has no top-level `defaultCache`
field — only the PER-ENDPOINT `endpoints[].cache` (identical shape: `enabled`/`ttlSeconds`/
`methods`/`keyHeaders`/`keyQueryParams`/`keyBody`). Since `catfacts`' `defaultCache` declared
`methods: ["GET", "HEAD"]` and all 3 of its endpoints are `GET`, `manifest.yaml` attaches the
**identical** cache object to each of the 3 `catfacts` endpoints individually — a faithful
re-expression at the granularity the schema supports, not an approximation or a dropped feature.
See the manifest's own comment for the full reasoning, including why this translation would NOT
generalize losslessly to a connector whose endpoints use varying methods.

## Prerequisites

- A running dev cluster with a provisioned tenant (`acme` by default).
- The `yoizen` CLI (`cd sdk && bun link`, or `cd sdk && bun run bin/yoizen.ts ...`).
- CLI environment: `YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
  `YOIZEN_PASSWORD` — same as every other sample.
- The two secret VALUES above (`httpbin-basic-auth-username`, `httpbin-basic-auth-password`) — the
  defaults `user`/`passwd` reproduce the sample's original out-of-the-box behavior.

## Provision (declarative)

```bash
cd sdk && bun link   # one-time; or prefix each call with `bun run bin/yoizen.ts`

yoizen manifests validate -f ../integrations/http/http-connectors/manifest.yaml
yoizen manifests plan     -f ../integrations/http/http-connectors/manifest.yaml
env 'httpbin-basic-auth-username=user' 'httpbin-basic-auth-password=passwd' \
  yoizen manifests apply  -f ../integrations/http/http-connectors/manifest.yaml --secrets-from-env
```

A second `apply` is a no-op once converged.

## Run / verify

```bash
cd integrations/http/http-connectors
./run.sh
```

`run.sh` (`src/index.ts`) is **read-only**: it lists `context=external` connectors and confirms
all 5 manifest-declared connectors exist, printing each one's id, `authType`, and endpoint count.
It never creates or modifies platform objects — apply the manifest first.

### The `connectors/*.json` directory

`connectors/` holds the five pre-manifest connector payloads (`catfacts.json`, `httpbin.json`,
`httpbin-basic-auth.json`, `jsonplaceholder.json`, `pokeapi.json`). They are **not** read by
`manifest.yaml`, `run.sh` or `src/index.ts` — provisioning is entirely manifest-driven — but they
are not dead either: `scripts/e2e/README.md` uses `pokeapi.json` as a ready-made
`POST /api/connectors` body (`curl … -d @integrations/http/http-connectors/connectors/pokeapi.json`).
Keep them in sync with `manifest.yaml` by hand if you change a connector's shape.

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

Get the connector ids with `./run.sh` (prints them) or:

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

- **`401` from `httpbin-basic-auth`** — the Basic credentials don't match the URL path segments
  declared in `manifest.yaml`. Re-apply with matching secret values, or edit both the secret values
  and the endpoint paths together (see § Secrets above).
- **Connector present but calls fail at runtime** — the public API must be reachable from inside
  the cluster (egress). The connector is provisioned regardless of whether the API is reachable
  from your laptop.
- **`unallowlisted_symbolic_ref` / schema errors on `apply`** — this manifest was validated locally
  against `integrationManifestSchema.safeParse` + `validateManifestStructuralRules` before being
  committed; if you see these, check for a local edit that broke the shape.
