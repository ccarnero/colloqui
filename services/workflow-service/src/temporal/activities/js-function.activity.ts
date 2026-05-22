import type { JsFunctionArgs, WorkflowExecutionContext } from "@yoizen/shared";

/**
 * Executes inline JS supplied by the workflow definition.
 *
 * IDEMPOTENCY CONTRACT (2026-05-22 stress post-mortem
 * `post-mortem/POST-MORTEM.md` §P1.3): the activity itself is pure —
 * it just evaluates `args.code` against the current execution
 * context. Whatever side effects the user JS performs (HTTP calls,
 * Redis writes, billing operations) MUST be idempotent under
 * Temporal-retry, because activities can complete on the worker side
 * AFTER Temporal has already started a new attempt (see
 * `post-mortem/workflow-worker.log` 5x `Activity not found on
 * completion ... workflow execution already completed`).
 *
 * The activity does NOT enforce this — it's a contract surfaced in
 * `services/workflow-service/AGENTS.md`. Authors of `jsFunction`
 * actions are responsible for keying side effects on a stable
 * identifier from `context` (e.g. `context.request.messageId`).
 */
export async function executeJsFunction(
  args: JsFunctionArgs,
  context: WorkflowExecutionContext,
): Promise<unknown> {
  const fn = new Function("return " + args.code)();
  const result = await fn(context);
  return result;
}
