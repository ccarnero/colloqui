# Proposal: YoizenClaw Credential Redesign

## Intent

### Problem Statement
Admin credential management is structurally disconnected from YoizenClaw runtime usage. The admin path stores generic DB-backed credentials (`api_key`, `oauth`, `basic`, `custom`) with a plaintext `value`, and the UI only exposes generic fields. The runtime does not read that table; it resolves provider-aware credentials from environment variables and `runtime-secrets/credentials.env`. As a result, operators can manage credentials in the console without affecting real runtime execution.

## Goals

- Replace the generic credential model with provider-aware fields required by runtime providers.
- Establish a single supported path from admin-managed credentials to runtime consumption.
- Make rotation meaningful by connecting admin updates to runtime-readable credentials.

## Non-Goals

- Adding new LLM providers beyond those already supported by runtime.
- Redesigning agents, jobs, or config-file management.
- Solving a platform-wide secret-management strategy outside YoizenClaw.

## Scope

### In Scope
- Redefine credential contracts around provider-specific payloads such as `api_key`, `base_url`, `region`, `project_id`, service-account data, and AWS credentials.
- Update admin-service credential CRUD, validation, persistence, and rotation to use provider-aware schemas instead of generic `type` + `value`.
- Redesign admin-console credential forms and views to capture, mask, and edit provider-specific fields.
- Define the runtime integration path so admin-managed credentials become the source consumed by YoizenClaw runtime.
- Specify migration handling for existing generic credential records.

### Out of Scope
- Backward-compatible support for the current generic credential UX long term.
- Consuming `credential_rotated` without redesigning the underlying credential delivery contract.

## Capabilities

### New Capabilities
- `provider-aware-credentials`: Provider-specific credential schema, validation, and masking.
- `runtime-credential-delivery`: Explicit contract that makes admin-managed credentials available to runtime.

### Modified Capabilities
- `credentials-crud`: Replace generic fields with provider-aware payloads.
- `credential-rotation`: Ensure rotation updates the runtime-consumable credential source.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Migrating generic rows loses provider detail | Med | Define per-provider migration rules and fallback review path |
| Runtime/admin contract introduces drift again | Med | Version the credential payload and validate end-to-end |
| UI complexity grows across providers | Low | Start with providers already implemented by runtime |

## Rollback Plan

1. Keep existing runtime env-based loading available behind a migration flag.
2. Revert admin UI/API to the previous generic flow if provider-aware delivery fails.
3. Preserve pre-migration credential records until runtime reads the new source successfully.

## Effort Estimate

- **Size**: L
- **Estimated impact**: 10-15 modified files across `yoizenclaw-admin-service`, `admin-console`, and YoizenClaw runtime/config delivery.
- **Complexity drivers**: data migration, provider-specific schemas, cross-service runtime contract.

## Success Criteria

- [ ] Admin-managed credentials map to the exact provider fields required by runtime.
- [ ] A rotated credential changes the source actually consumed by runtime.
- [ ] Generic `type`/`value` is no longer the primary contract for YoizenClaw credentials.
