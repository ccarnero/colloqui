import { trimDetailLine } from "./trim-detail-line.js";

/**
 * Renders the typed `{ error: { ... } }` body that
 * `POST /manifests/:name/(plan|apply)` returns on a 409
 * (`apply.controller.ts` / `plan.controller.ts`), covering every shape those
 * controllers actually emit:
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

  if (typeof ef.message === "string") {
    const kindPrefix = typeof ef.kind === "string" ? `${ef.kind}: ` : "";
    return [trimDetailLine(`  ${kindPrefix}${ef.message}`)];
  }

  return undefined;
}
