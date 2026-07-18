import { formatRawBody } from "./format-raw-body.js";
import { formatTypedError } from "./format-typed-error.js";
import { formatValidationErrors } from "./format-validation-errors.js";
import { unwrapSdkError } from "./unwrap-sdk-error.js";

/**
 * Extracts human-readable detail lines from a CLI command failure, so the
 * caller sees the SAME structured detail `manifests plan` already renders
 * for preconditions, instead of just the generic
 * `"apply request failed for '<name>'"` wrapper message.
 *
 * `CliError` (see `cli-error.ts`) always wraps the underlying `SdkError`
 * thrown by the transport (`core/transport.ts`'s `mapStatusToError`) in its
 * `.cause`; that `SdkError.details` carries `{ httpStatus, body }` where
 * `body` is the RAW JSON the provisioning-service controller sent. This
 * function unwraps that error (`unwrap-sdk-error.ts`) and dispatches the body
 * to the renderer that matches the handful of shapes provisioning-service
 * actually returns:
 *
 * - `PUT /manifests/:name` 400 validation `{ valid: false, errors: [...] }`
 *   -> `format-validation-errors.ts`.
 * - `POST /manifests/:name/(plan|apply)` 409 typed `{ error: { kind, ... } }`
 *   (`cycle_detected`, `apply_failed`, or a bare `{ kind, message }`)
 *   -> `format-typed-error.ts`.
 * - Anything else -> `format-raw-body.ts` (JSON-stringified + trimmed), so no
 *   body shape is ever silently swallowed.
 *
 * Never touches request bodies (only response bodies), so it can never echo a
 * secret value — `apply`/`plan` requests never carry secret values in the
 * first place (those travel exclusively via `PUT /secrets/:name`, see
 * `apply-command.ts`'s header comment), and this function only reads
 * `SdkError.details.body`, which `transport.ts` populates exclusively from
 * the RESPONSE. Server-supplied message text IS rendered verbatim (trimmed
 * for length) — the provisioning-service is a trusted source.
 */
export function formatErrorDetail(error: unknown): string[] {
  const sdkError = unwrapSdkError(error);
  if (!sdkError) {
    return [];
  }

  const details = sdkError.details as { body?: unknown } | undefined;
  const body = details?.body;
  if (!body || typeof body !== "object") {
    return [];
  }
  const bodyRecord = body as Record<string, unknown>;

  const validationLines = formatValidationErrors(bodyRecord);
  if (validationLines) {
    return validationLines;
  }

  const typedErrorLines = formatTypedError(bodyRecord.error);
  if (typedErrorLines) {
    return typedErrorLines;
  }

  return formatRawBody(body);
}
