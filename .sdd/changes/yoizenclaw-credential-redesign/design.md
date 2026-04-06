# Design: YoizenClaw Credential Redesign

## Overview

This change replaces the generic admin credential contract with a
provider-aware credential model and makes `config_sync` the single supported
delivery path into runtime. The core design principle is to separate
operator-facing credential management from runtime materialization while
ensuring they remain connected by one explicit, versioned contract.

## Architecture

### Components

1. `admin-console`
   - Renders provider-specific create/edit forms.
   - Masks secret fields and preserves already-stored secrets unless replaced.

2. `yoizenclaw-admin-service`
   - Owns CRUD, validation, masking metadata, persistence, and rotation.
   - Stores provider-aware credential payloads instead of generic `type` +
     `value`.
   - Emits or triggers sync intent after create, update, rotate, or delete.

3. `config_sync`
   - Reads the canonical admin-managed credential records.
   - Transforms them into the runtime-supported env format.
   - Writes the materialized output to `runtime-secrets/credentials.env`.

4. YoizenClaw runtime
   - Remains provider-aware and continues reading from environment / runtime
     secrets.
   - Does not read admin database records directly.

### Target Flow

1. Operator creates or updates a credential in the admin UI.
2. Admin service validates the payload against the selected provider schema.
3. Admin service persists the normalized provider payload.
4. `config_sync` materializes the payload into
   `runtime-secrets/credentials.env`.
5. Runtime consumes the materialized provider variables through its existing
   env-based contract.

This keeps runtime decoupled from admin persistence and establishes one
supported path from admin state to runtime state.

## Data Model

### Canonical Credential Shape

Each credential record should use a provider-aware payload:

```json
{
  "schema_version": 1,
  "provider": "openai|azure_openai|bedrock|vertex|gcp_service_account|custom_supported_provider",
  "name": "operator-facing label",
  "status": "active|inactive",
  "payload": {
    "api_key": "secret",
    "base_url": "optional endpoint",
    "region": "optional provider region",
    "project_id": "optional project",
    "service_account": {
      "client_email": "optional",
      "private_key": "optional",
      "project_id": "optional"
    },
    "aws": {
      "access_key_id": "optional",
      "secret_access_key": "optional",
      "session_token": "optional"
    }
  }
}
```

### Modeling Rules

1. `provider` selects the validation schema and the runtime mapping rules.
2. `payload` only allows fields supported by that provider.
3. Secret and non-secret fields are stored separately in metadata for masking
   and partial updates, even if persisted together physically.
4. `schema_version` versions the admin-to-sync contract to prevent future drift.

### Validation Strategy

Use a provider registry in the admin service:

1. Schema per provider.
2. Required fields per provider.
3. Secret-field list for masking.
4. Runtime env mapping per provider.

This avoids reintroducing a generic free-form credential model.

## Runtime Delivery And Sync Strategy

### Chosen Strategy

`config_sync` is the only supported delivery mechanism.

### Why

1. Runtime already consumes env/runtime-secret material.
2. Direct DB reads from runtime would recreate coupling and drift.
3. A sync boundary allows validation, normalization, and atomic file output.

### Sync Contract

`config_sync` should consume only active credentials and produce a deterministic
`credentials.env` output using provider-aware variable names expected by
runtime. The sync process should:

1. Read canonical provider-aware records.
2. Validate record `schema_version`.
3. Map each provider payload to runtime env keys.
4. Write the full target file atomically.
5. Fail closed if a record is invalid rather than emitting partial malformed
   secrets.

### Delivery Semantics

1. Full-file materialization is preferred over incremental patching.
2. Sync is triggered after credential mutations and can also run on-demand.
3. Rotation is complete only when the new value is persisted and the synced
   runtime file has been updated successfully.

## Migration Approach

### Migration Principle

Existing generic records cannot be trusted as runtime-ready because they lack
provider-specific structure. Migration must therefore classify records into
automatic conversion, partial conversion, or manual review.

### Migration Buckets

1. Automatic conversion
   - Records with clear provider identity and enough fields to populate a valid
     provider payload.

2. Partial conversion
   - Records where a provider can be inferred but required provider fields are
     missing.
   - Migrate into a disabled or review-required state.

3. Manual review
   - Records with generic `custom` semantics or ambiguous provider mapping.

### Migration Steps

1. Introduce the new provider-aware schema and persistence path.
2. Backfill existing generic rows into the new structure where possible.
3. Mark ambiguous rows for operator review.
4. Run `config_sync` from the new source only after migrated records validate.
5. Decommission generic `type`/`value` as the primary contract after successful
   cutover.

## Security Controls

1. Secret fields must be masked in API responses and UI views.
2. Partial updates must preserve existing secret values when the operator does
   not explicitly replace them.
3. Validation must reject unsupported fields to avoid accidental secret sprawl.
4. Sync output must contain only the fields required by runtime.
5. Invalid credentials must not be materialized into runtime secrets.
6. Rotation and sync operations should be auditable with structured logs that
   never print raw secret values.
7. Migration should preserve old records until cutover is verified, but they
   must not become an alternate long-term source of truth.

## Tradeoffs

### Accepted

1. Higher UI and validation complexity in exchange for an accurate runtime
   contract.
2. A provider registry adds maintenance overhead, but it prevents the generic
   model from drifting away from runtime needs.
3. Full-file sync may rewrite more data than necessary, but it is simpler and
   safer than incremental secret patching.

### Rejected

1. Direct runtime reads from admin persistence.
   - Rejected because it couples runtime to admin storage and bypasses the real
     supported delivery path.

2. Keeping generic `type` + `value` as a compatibility-first contract.
   - Rejected because it does not encode the provider-specific fields runtime
     actually needs.

3. Supporting both generic and provider-aware flows indefinitely.
   - Rejected because dual paths would reintroduce drift and operator confusion.

## Phased Implementation Slices

### Slice 1: Contract And Validation

1. Define provider registry and canonical credential schema.
2. Update admin-service DTOs, validation, persistence, and masking metadata.
3. Keep old records readable only as migration input.

### Slice 2: Admin UI

1. Replace generic credential forms with provider-specific forms.
2. Add secret masking and explicit replace behavior.
3. Show review-required state for migrated ambiguous records.

### Slice 3: Sync Delivery

1. Implement provider-aware export in `config_sync`.
2. Materialize deterministic `runtime-secrets/credentials.env` output.
3. Treat sync success as part of rotation completion.

### Slice 4: Migration And Cutover

1. Migrate existing generic records into the new schema.
2. Flag partial and ambiguous records for manual review.
3. Cut runtime delivery to the new canonical source through `config_sync`.

### Slice 5: Cleanup

1. Remove generic credential assumptions from admin API and UI.
2. Retire old contract fields from normal operations.
3. Keep rollback support only for the migration window defined in the proposal.

## Rationale Summary

The redesign succeeds only if admin-managed credentials become the exact source
that runtime effectively consumes. The cleanest way to achieve that is not to
teach runtime about admin persistence, but to make admin persistence feed the
already-supported runtime secret path through a strict provider-aware sync
contract.
