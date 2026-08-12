import type {
  ManifestUndeployResult,
  ResourceUndeployOutcome,
  SecretUndeployOutcome,
} from "../resources/manifests/index.js";

/**
 * Formats the report `yoizen manifests undeploy --yes` prints after a run
 * (`POST /provisioning/manifests/:name/undeploy`'s 200 body).
 *
 * Same plain-text, tab-separated, one-resource-per-line style as
 * `format-verdict-table.ts` — deliberately NOT that function, because its
 * header column is `VERDICT` and its doc comment pins the literal words
 * `create|update|noop` as a downstream gate's assertion source; undeploy's
 * column is `ACTION` with a different word set
 * (`deleted|not_found|skipped_external|skipped_no_delete_api`, the
 * `UndeployAction` union). No ANSI colors, no reflow — greppable as-is.
 *
 * EVERY cell goes through `cell()`/`count()`/`flag()` so a server body that
 * ever drifts from `ManifestUndeployResult` degrades to a visible
 * `(unknown)` instead of printing the string `undefined` at the user. That is
 * not paranoia: the SDK's `ReconcileKbOutcome` type drifted from the service
 * shape until commit d6fca63f and the CLI printed `<kb>/undefined: undefined`
 * after every apply. Pinned by `format-undeploy-report.test.ts`.
 */
export function formatUndeployReport(report: ManifestUndeployResult): string[] {
  const resources: readonly ResourceUndeployOutcome[] = Array.isArray(
    report.resources
  )
    ? report.resources
    : [];
  const secrets: readonly SecretUndeployOutcome[] = Array.isArray(
    report.secrets
  )
    ? report.secrets
    : [];

  const lines = ["KIND\tNAME\tACTION"];
  for (const resource of resources) {
    const outcome = (resource ?? {}) as Partial<ResourceUndeployOutcome>;
    lines.push(
      [cell(outcome.kind), cell(outcome.name), cell(outcome.action)].join("\t")
    );
  }

  if (secrets.length > 0) {
    lines.push("", "SECRETS:");
    for (const secret of secrets) {
      const outcome = (secret ?? {}) as Partial<SecretUndeployOutcome>;
      const scope = outcome.scope;
      const scopeText =
        scope && typeof scope === "object"
          ? `${cell(scope.kind)}:${cell(scope.owner)}`
          : cell(undefined);
      lines.push(
        `  ${cell(outcome.name)} (${scopeText}): ${cell(outcome.action)}`
      );
    }
  }

  lines.push(
    "",
    `deleted=${count(report.deletedCount)} notFound=${count(report.notFoundCount)} skipped=${count(report.skippedCount)} checksumRows=${count(report.checksumRowsDeleted)} manifestRecordDeleted=${flag(report.manifestRecordDeleted)} durationMs=${count(report.durationMs)}`
  );
  return lines;
}

function cell(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "(unknown)";
}

function count(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "(unknown)";
}

function flag(value: unknown): string {
  return typeof value === "boolean" ? String(value) : "(unknown)";
}
