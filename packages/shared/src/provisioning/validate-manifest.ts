// Single entrypoint for manifest validation: zod schema parse (shape,
// unknown-key rejection, per-object refinements like exactly-one image or
// buildRef) followed by the cross-manifest structural rules (uniqueness,
// >=1 inbound channel, >=1 process, ref resolution). Never throws — returns
// a typed Result so callers get a verbose error list on failure.

import { err, ok, type Result } from "../lib/result";
import {
  type IntegrationManifest,
  integrationManifestSchema,
} from "./manifest.schema";
import { validateManifestStructuralRules } from "./validate-structural-rules";
import type { ManifestValidationError } from "./validation-error.interfaces";

export function validateManifest(
  input: unknown
): Result<IntegrationManifest, ManifestValidationError[]> {
  const parsed = integrationManifestSchema.safeParse(input);

  if (!parsed.success) {
    const errors: ManifestValidationError[] = parsed.error.issues.map(
      (issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
        message: issue.message,
      })
    );
    return err(errors);
  }

  const structuralErrors = validateManifestStructuralRules(parsed.data);
  if (structuralErrors.length > 0) {
    return err(structuralErrors);
  }

  return ok(parsed.data);
}
