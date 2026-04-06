import type { JsFunctionArgs, WorkflowExecutionContext } from "@yoizen/shared";

export async function executeJsFunction(
  args: JsFunctionArgs,
  context: WorkflowExecutionContext,
): Promise<unknown> {
  const fn = new Function("return " + args.code)();
  const result = await fn(context);
  return result;
}
