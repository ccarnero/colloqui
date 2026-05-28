import type { JsFunctionArgs, WorkflowExecutionContext } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";

const logger = new PinoLoggerService("js-function.activity");

export async function executeJsFunction(
  args: JsFunctionArgs,
  context: WorkflowExecutionContext,
): Promise<unknown> {
  if (context.executionId) {
    logger.log(`jsFunction executionId=${context.executionId} tenant=${context.workflow.tenant}`);
  }
  const fn = new Function("return " + args.code)();
  const result = await fn(context);
  return result;
}
