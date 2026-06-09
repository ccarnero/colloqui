import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";

type BuiltinFunction = (
  ...args: unknown[]
) => Promise<Record<string, unknown>>;

@Injectable()
export class FunctionActionService {
  private readonly logger = new PinoLoggerService(FunctionActionService.name);
  private readonly functions = new Map<string, BuiltinFunction>();

  constructor() {
    this.registerDefaults();
  }

  async execute(
    functionName: string,
    parameters: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    this.logger.log(`[function-action] Calling function: '${functionName}'`);

    if (functionName === "python_code") {
      this.logger.warn(
        `[function-action] 'python_code' action is NOT supported in TypeScript runtime. ` +
          `Use 'llm_call', 'webhook', or 'function' action types instead.`,
      );
      return {
        supported: false,
        message: "python_code action is not supported in TypeScript runtime",
      };
    }

    const func = this.functions.get(functionName);
    if (!func) {
      throw new Error(`Unknown function: '${functionName}'`);
    }

    const result = await func(parameters);
    this.logger.log(
      `[function-action] '${functionName}' executed successfully`,
    );

    return { result };
  }

  registerFunction(name: string, fn: BuiltinFunction): void {
    this.functions.set(name, fn);
    this.logger.log(`[function-action] Registered function: '${name}'`);
  }

  unregisterFunction(name: string): boolean {
    return this.functions.delete(name);
  }

  getRegisteredFunctions(): string[] {
    return [...this.functions.keys()];
  }

  private registerDefaults(): void {
    this.functions.set("cleanup_old_conversations", async (params) => {
      const retentionDays = Number((params as Record<string, unknown>).retention_days ?? 30);
      this.logger.log(
        `[function-action] cleanup_old_conversations: retention=${retentionDays} days`,
      );
      return { deleted_count: 0 };
    });

    this.functions.set("get_conversation_metrics", async () => ({
      total_conversations: 0,
      active_today: 0,
      average_duration: 0,
    }));

    this.functions.set("export_data", async (params) => {
      const formatType = String((params as Record<string, unknown>).format_type ?? "json");
      return { format: formatType, location: "/tmp/export.json" };
    });

    this.functions.set("notify_backend", async (params) => {
      const message = String((params as Record<string, unknown>).message ?? "");
      this.logger.log(`[function-action] notify_backend: ${message}`);
      return { sent: true };
    });
  }
}
