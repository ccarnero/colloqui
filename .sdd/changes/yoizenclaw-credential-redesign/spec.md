# Spec: YoizenClaw Credential Redesign

## Summary

Redesign YoizenClaw credentials around runtime-supported providers and make admin-managed credentials flow to runtime through the existing `config_sync` path that produces `runtime-secrets/credentials.env`.

## Requirement 1: Provider-Aware Credential Contract

YoizenClaw credentials MUST be modeled by `provider` plus a provider-specific payload instead of the generic `type` + `value` contract.

### Acceptance Criteria

- Supported providers are limited to: `openai`, `anthropic`, `google`, `google-vertex`, `bedrock`, `groq`, `mistral`, `openrouter`, `xai`, `cohere`, `cerebras`, `huggingface`, and `mock`.
- Each credential record stores a `provider`, a schema/version identifier, and only the fields required or allowed by that provider.
- Provider payloads support runtime-relevant fields such as `api_key`, `base_url`, `region`, `project_id`, service-account data, and AWS credentials where applicable.
- Unsupported providers MUST be rejected.
- Generic `type`, `value`, `oauth`, `basic`, and `custom` semantics MUST NOT remain the primary YoizenClaw credential contract.

### Scenarios

#### Scenario: Create API-key provider credential
- Given an operator selects `openai`
- When they submit a valid provider payload with `api_key`
- Then the system stores a credential record with `provider=openai` and a validated provider-aware payload.

#### Scenario: Create cloud provider credential
- Given an operator selects `google-vertex` or `bedrock`
- When they submit the provider-specific runtime fields
- Then the system accepts only the fields allowed by that provider and rejects missing required fields.

#### Scenario: Reject unsupported provider
- Given an operator submits a credential for an unknown provider
- When the request is validated
- Then the system rejects the request and does not persist the record.

## Requirement 2: Runtime Delivery Through `config_sync`

Admin-managed YoizenClaw credentials MUST reach runtime only through the supported `config_sync` delivery path that materializes provider-aware runtime secrets into `runtime-secrets/credentials.env`.

### Acceptance Criteria

- Create, update, rotate, and delete operations on active YoizenClaw credentials trigger or enqueue `config_sync`.
- `config_sync` renders credentials into the runtime contract consumed from environment variables and `runtime-secrets/credentials.env`.
- The system records delivery state for each credential set, at minimum distinguishing `pending`, `synced`, and `failed`.
- Runtime delivery MUST preserve provider-aware field names and semantics so no generic translation layer is required at runtime.

### Scenarios

#### Scenario: Successful credential sync
- Given an operator rotates an active `anthropic` credential
- When `config_sync` completes successfully
- Then `runtime-secrets/credentials.env` contains the updated runtime-readable value and the credential is marked `synced`.

#### Scenario: Sync failure does not silently cut over
- Given an operator updates an active credential
- When `config_sync` fails to write the runtime secret output
- Then the system marks the credential delivery as `failed`, exposes the failure to admin surfaces, and preserves the last known good runtime-delivered credential state.

## Requirement 3: Secure Storage and Secret Masking

Sensitive credential fields MUST be stored securely and exposed to API/UI consumers only as masked or write-only values.

### Acceptance Criteria

- Secret fields such as `api_key`, AWS secrets, tokens, and service-account private material are never returned in plaintext after initial submission.
- Read APIs return masked placeholders plus metadata indicating whether a secret value is already present.
- Update APIs allow non-secret metadata changes without forcing secret re-entry.
- Replacing a secret field requires an explicit new value; omitting the field preserves the existing stored secret.

### Scenarios

#### Scenario: Read masked credential details
- Given a stored `groq` credential exists
- When an operator opens the credential detail view
- Then the API returns masked secret values and enough metadata for the UI to show that a secret is configured.

#### Scenario: Update non-secret fields without resubmitting secret
- Given a credential already has a stored secret value
- When an operator updates a non-secret field such as `base_url` or display metadata
- Then the stored secret remains unchanged.

#### Scenario: Replace a secret value
- Given a credential already has a stored secret value
- When an operator submits a replacement secret
- Then the old secret is replaced and the new value becomes the one delivered through `config_sync` after sync succeeds.

## Requirement 4: Migration From Generic Credentials

Existing generic YoizenClaw credential records MUST be migrated into the provider-aware model when possible and explicitly flagged for manual review when not safely mappable.

### Acceptance Criteria

- Generic records with enough verified provider context are migrated into the new provider-aware structure.
- Records that cannot be safely mapped are marked `manual_review_required` and are excluded from active runtime delivery.
- Migration preserves original source data until the new provider-aware record is verified.
- Migration results are auditable at least at the level of migrated, skipped, and manual-review outcomes.

### Scenarios

#### Scenario: Migrate known API-key record
- Given a legacy generic credential is already associated with a supported provider and contains a usable API key
- When migration runs
- Then the system creates the corresponding provider-aware credential and marks it ready for sync.

#### Scenario: Flag ambiguous legacy record
- Given a legacy generic credential cannot be mapped to one supported provider payload with confidence
- When migration runs
- Then the system marks the record `manual_review_required` and does not include it in runtime delivery.

## Requirement 5: Provider-Aware Admin API and UI

The admin API and UI MUST present provider-specific forms and views that match the runtime credential contract instead of a generic credential editor.

### Acceptance Criteria

- Credential create and edit flows require provider selection first, then render only fields relevant to that provider.
- Validation errors identify the provider field that is missing, invalid, or unsupported.
- List and detail surfaces show provider, sync state, and whether required secret material is configured.
- Secret inputs are masked in edit mode and clearly indicate whether a replacement is optional or required.

### Scenarios

#### Scenario: Provider-specific form rendering
- Given an operator selects `cohere`
- When the create form loads
- Then the UI shows only the fields required or allowed for `cohere` credentials.

#### Scenario: Provider-specific validation error
- Given an operator submits a `google-vertex` credential without a required provider field
- When the request is validated
- Then the API rejects the request with a field-specific validation error and the UI displays that error inline.

#### Scenario: Display sync state in admin surfaces
- Given a credential has a failed delivery attempt
- When the operator views the credential list or details
- Then the sync state is visible so the operator can distinguish persisted data from runtime-delivered data.
