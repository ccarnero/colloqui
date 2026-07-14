// Typed, verbose error surface for manifest validation. Every validation
// failure (zod schema issue or structural-rule violation) is reported as one
// entry with a dot/bracket path into the manifest and a human-readable
// message — nothing fails silently or collapses into a single string.

export interface ManifestValidationError {
  /** Dot/bracket path into the manifest, e.g. "spec.channels[0].secretRef". */
  path: string;
  /** Human-readable explanation of the violation. */
  message: string;
}
