import { createPinoLogger } from "./pino.logger";
import { filterLogContext } from "./pii-filter";
import { type Logger as PinoInstance } from "pino";

export type LogStep =
  | "publishing"
  | "published"
  | "failed"
  | "completed"
  | "info"
  | "provisioning"
  | "deprovisioning";

interface StructuredLogEntry {
  level: string;
  timestamp: string;
  step: LogStep;
  tenant: string;
  channel: string;
  message: string;
  [key: string]: unknown;
}

export class StructuredLogger {
  private readonly logger: PinoInstance;
  private readonly serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.logger = createPinoLogger(serviceName);
  }

  info(
    step: LogStep,
    tenant: string,
    channel: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const entry = this.buildEntry(
      "info",
      step,
      tenant,
      channel,
      message,
      context,
    );
    this.logger.info(entry, message);
  }

  error(
    step: LogStep,
    tenant: string,
    channel: string,
    message: string,
    error?: Error | unknown,
    context?: Record<string, unknown>,
  ): void {
    const entry = this.buildEntry(
      "error",
      step,
      tenant,
      channel,
      message,
      context,
    );
    if (error instanceof Error) {
      entry.error_message = error.message;
      entry.error_stack = error.stack;
    } else if (error !== undefined) {
      entry.error_message = String(error);
    }
    this.logger.error(entry, message);
  }

  warn(
    step: LogStep,
    tenant: string,
    channel: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const entry = this.buildEntry(
      "warn",
      step,
      tenant,
      channel,
      message,
      context,
    );
    this.logger.warn(entry, message);
  }

  private buildEntry(
    level: string,
    step: LogStep,
    tenant: string,
    channel: string | undefined,
    _message: string,
    context?: Record<string, unknown>,
  ): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      level,
      timestamp: new Date().toISOString(),
      step,
      tenant,
      channel: channel ?? "internal",
      message: _message,
    };

    if (context) {
      const filtered = filterLogContext(context);
      for (const [key, value] of Object.entries(filtered)) {
        entry[key] = value;
      }
    }

    return entry;
  }
}
