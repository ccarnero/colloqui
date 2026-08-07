Class: RECORD
Summary: RECORD (ruling Option B, 2026-08-07) of the security contract encoded by the retired `credentials-security` e2e suite of agent-admin-service — the `value` field never leaves the service, rotation emits an event, four accepted credential types. Nothing in this file is implemented today.

# Credentials Security Contract (retired suite — RECORD)

> **Status: not implemented.** `/admin/credentials` and `/admin/channels` do
> not exist in `services/agent-admin-service/src` — there is no credentials
> module, controller, service, or DTO. The tests that described them were
> phantom: they asserted behaviour of an API that was never built.
>
> **Ruling (user, 2026-08-07 — Option B): RETIRE.** The 18 phantom tests were
> deleted instead of repaired, because credentials/channels are not this
> service's features and are not being built here. The ruling is recorded in
> [`PENDIENTES/09-hallazgos-group-c.spec.md`](../../PENDIENTES/09-hallazgos-group-c.spec.md)
> (user decision 4, task T01c). This document rescues the contract those tests
> encoded, so that if credentials are ever built — here or in another service —
> the security requirements are not re-derived from scratch.

## Where the contract came from

The deleted/edited test files, at the commit that retired them:

| File | Fate | Tests removed |
| --- | --- | --- |
| `services/agent-admin-service/test/e2e/credentials-security.e2e.spec.ts` | deleted | 13 |
| `services/agent-admin-service/test/e2e/multi-tenancy.e2e.spec.ts` | edited | 2 (credentials + channels isolation) |
| `services/agent-admin-service/test/e2e/nats-events.e2e.spec.ts` | edited | 3 (credential rotate/update, mixed workflow) |

The tenant-schema DDL used by the e2e bootstrap
(`services/agent-admin-service/test/e2e/setup.ts`) still creates the
`credentials` and `channels` tables — the tables are part of the seeded test
schema, not of any served endpoint.

## The contract, as the suite encoded it

### C1 — the `value` field NEVER appears in ANY response

This was the suite's central claim, asserted on every shape of response:

| Response | Assertion |
| --- | --- |
| `GET /admin/credentials` (list) | every item: no `value` property, `value === undefined` |
| `GET /admin/credentials` with `?type=api_key` filter | every filtered item: no `value` property |
| `GET /admin/credentials` with `?limit=&offset=` pagination | every page item: no `value` property |
| `GET /admin/credentials/:id` (single) | body has no `value` property, `body.value === undefined` |
| `POST /admin/credentials` (create, `201`) | body has no `value` property, even though the request carried it |
| `PUT /admin/credentials/:id` (update, `200`) | body has no `value` property, even though the request carried it |
| `PUT /admin/credentials/:id/rotate` (rotate, `200`) | body has no `value` property |

The suppression is unconditional — it does not depend on the stored value:
empty string, a 10 000-character value, and a value full of special characters
(`!@#$%^&*()_+-=[]{}|;':",./<>?` plus backtick, tilde, `\n`, `\t`, `\r`) were
each asserted to be suppressed the same way.

Suppression is a **serialization** rule, not a storage rule: after a create the
suite read the row back with SQL and asserted `credentials.value` equals the
value that was posted; after an update it asserted the column now holds the new
value. The secret is persisted verbatim and withheld from the API surface.

### C2 — the safe field set

Everything except `value` is returned. A credential row exposed by the API
carries: `id`, `name`, `type`, `metadata` (JSON object, echoed back verbatim —
e.g. `{ provider: "aws", region: "us-east-1" }`), `expires_at`, `is_active`,
`is_encrypted`, `created_at`, `updated_at`.

### C3 — list envelope

`GET /admin/credentials` returns an object, not a bare array:
`{ credentials: Credential[], total: number }`, where `total` is the unfiltered/
unpaginated count (a 5-item fixture with `limit=2` returned 2 items and
`total: 5`).

### C4 — accepted credential types

Exactly four, all accepted by `POST /admin/credentials`: `api_key`, `oauth`,
`basic`, `custom`. The same four are the `CHECK` constraint on the
`credentials.type` column in the e2e schema.

### C5 — rotation emits an event

`PUT /admin/credentials/:id/rotate` takes `{ new_value }`, writes the new secret
to the column, answers `200` without the value, and emits a
`credential.rotated` event with:

- `type` — `io.yoizen.platform.admin.credential.rotated.v1`
- `payload.credentialId` — the rotated credential's id
- `payload.type` — the credential type (e.g. `api_key`)
- `payload.rotatedAt` — timestamp
- `metadata.tenantId` — the tenant that owns the credential

Updating a credential's `value` through `PUT /admin/credentials/:id` was
asserted to emit the *same* `credential.rotated` event — any change of the
secret is a rotation, whichever endpoint performed it.

Note for whoever implements this: `NatsPublisher`
(`services/agent-admin-service/src/providers/nats.provider.ts`) has no
`publishCredentialRotated` method, and neither `@yoizen/shared` nor the e2e mock
publisher defines a `credential.rotated` subject or event type. The event type
string above existed only inside the deleted test file; it is a requirement to
implement, not an existing constant to import.

### C6 — tenant isolation

Credentials and channels are per-tenant: a tenant listing `/admin/credentials`
(or `/admin/channels`) sees only rows from its own tenant database, selected by
the `TENANT_HEADER` header from `@yoizen/shared` (`x-yoizen-tenant`) through the
tenant connection manager — the deleted tests always used the symbol, never a
literal. The channels list envelope mirrored the credentials one:
`{ channels: Channel[] }`. The channel `type` values `webchat`, `whatsapp`,
`telegram`, `slack`, `custom` come from the `CHECK` constraint on `channels.type`
in the e2e schema (`services/agent-admin-service/test/e2e/setup.ts`), not from
any deleted assertion — the retired tests only ever inserted `webchat` and
`whatsapp`.

## If credentials get built

This document is the acceptance checklist: C1 (never serialize `value`) is the
security-critical one and deserves a regression test on every response shape the
new implementation offers, in the same task that adds the endpoints.
