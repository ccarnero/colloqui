import { trimDetailLine } from "./trim-detail-line.js";

/**
 * Renders the typed `{ error: { ... } }` body that
 * `POST /manifests/:name/(plan|apply|undeploy)` returns on a 409
 * (`apply.controller.ts` / `plan.controller.ts` / `undeploy.controller.ts`),
 * covering every shape those controllers actually emit:
 *
 * - `cycle_detected` (`plan.interfaces.ts` `CycleDetectedError`): the cycle
 *   node chain plus its message.
 * - `apply_failed` (`apply.interfaces.ts` `ManifestApplyFailure`): the single
 *   `failure` (kind + failing resource + message) that stopped the run, the
 *   applied/pending counts, and a hint to run `manifests plan` — apply's 409
 *   body only ever carries this ONE failure, never the full precondition list
 *   `manifests plan` renders (`build-manifest-plan.ts` records
 *   `unresolvable_external_ref` etc. as PLAN-only preconditions and simply
 *   omits the resource, so apply first trips on the downstream
 *   `unresolved_symbolic_ref` and stops there).
 * - `undeploy_blocked` (`undeploy.interfaces.ts` `UndeployBlockedError`):
 *   every blocking (manifest, resource) pair, one per line — decision 4's
 *   shared-resource guard.
 * - `undeploy_failed` (`undeploy.interfaces.ts` `ManifestUndeployFailure`):
 *   the failing step, processed/pending counts, and the resume hint (a
 *   partial undeploy KEEPS the stored manifest, decision 6).
 * - Any other typed `{ kind, message }` (e.g. a bare `KbReconcileError`):
 *   rendered generically.
 *
 * Server-supplied message text is trimmed via `trimDetailLine` for parity
 * with the raw-body fallback. Returns `undefined` when the value is not a
 * recognizable typed error object so the caller can fall through.
 */
export function formatTypedError(errorField: unknown): string[] | undefined {
  if (!errorField || typeof errorField !== "object") {
    return undefined;
  }
  const ef = errorField as Record<string, unknown>;

  if (ef.kind === "cycle_detected" && Array.isArray(ef.cycle)) {
    const lines = [`  cycle detected: ${ef.cycle.join(" -> ")}`];
    if (typeof ef.message === "string") {
      lines.push(trimDetailLine(`  ${ef.message}`));
    }
    return lines;
  }

  if (
    ef.kind === "apply_failed" &&
    ef.failure &&
    typeof ef.failure === "object"
  ) {
    const failure = ef.failure as Record<string, unknown>;
    const lines = [
      trimDetailLine(
        `  failure: ${String(failure.kind)} on ${String(failure.resourceKind)}/${String(failure.resourceName)}: ${String(failure.message)}`
      ),
    ];
    const appliedCount = Array.isArray(ef.applied) ? ef.applied.length : 0;
    const pendingCount = Array.isArray(ef.pending) ? ef.pending.length : 0;
    lines.push(
      `  applied=${String(appliedCount)} pending=${String(pendingCount)}`
    );
    // apply's 409 body only ever carries this ONE failure, never the full
    // precondition list `manifests plan` renders — point the caller there.
    lines.push(
      "  run `yoizen manifests plan -f <file>` for full precondition detail"
    );
    return lines;
  }

  // PENDIENTES/12-undeploy.spec.md T02 — the two typed 409 bodies
  // `POST /manifests/:name/undeploy` adds (`undeploy.controller.ts`;
  // `cycle_detected`, its third, is already covered above).
  if (ef.kind === "undeploy_blocked" && Array.isArray(ef.dependents)) {
    // Decision 4: another STORED manifest consumes a resource this one owns.
    // The pairs are the actionable part — the operator has to undeploy or
    // edit THOSE manifests first — so they are listed one per line rather
    // than left inside the server's prose message.
    const lines = [
      `  blocked by ${String(ef.dependents.length)} dependent reference(s) from other stored manifests:`,
    ];
    for (const dependent of ef.dependents) {
      const pair = (dependent ?? {}) as Record<string, unknown>;
      lines.push(
        trimDetailLine(
          `    ${String(pair.manifestName)} -> ${String(pair.resourceKind)}/${String(pair.resourceName)}`
        )
      );
    }
    if (typeof ef.message === "string") {
      lines.push(trimDetailLine(`  ${ef.message}`));
    }
    return lines;
  }

  if (
    ef.kind === "undeploy_failed" &&
    ef.failure &&
    typeof ef.failure === "object"
  ) {
    const failure = ef.failure as Record<string, unknown>;
    const processedCount = Array.isArray(ef.resources)
      ? ef.resources.length
      : 0;
    const pendingCount = Array.isArray(ef.pending) ? ef.pending.length : 0;
    return [
      trimDetailLine(
        `  failure: ${String(failure.kind)} on ${String(failure.resourceKind)}/${String(failure.resourceName)}: ${String(failure.message)}`
      ),
      `  processed=${String(processedCount)} pending=${String(pendingCount)}`,
      // The stored manifest is KEPT on a partial run (decision 6), so the
      // same command resumes from whatever is still live.
      "  the stored manifest was kept — re-run `yoizen manifests undeploy -f <file> --yes` to resume",
    ];
  }

  if (typeof ef.message === "string") {
    const kindPrefix = typeof ef.kind === "string" ? `${ef.kind}: ` : "";
    return [trimDetailLine(`  ${kindPrefix}${ef.message}`)];
  }

  return undefined;
}
