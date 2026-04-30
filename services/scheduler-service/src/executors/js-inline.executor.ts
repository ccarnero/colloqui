import { Injectable } from "@nestjs/common";
import { SCHEDULER_DEFAULT_TIMEOUT_MS } from "@yoizen/shared";
import type { IScheduleExecutor } from "./executor.interface";
import type { ISchedule } from "../modules/schedules/schedules.service";
import type { IExecutionResult } from "../engine/engine.service";

/**
 * Builds worker source that shadows `console.log` / `console.error` so
 * user script output is captured into `__output` — not the Nest/Pino logger.
 */
function buildInlineWorkerSource(script: string): string {
  return `
        const __output = [];
        console.log = (...args) => { __output.push(args.map(String).join(' ')); };
        console.error = (...args) => { __output.push('[ERR] ' + args.map(String).join(' ')); };
        try {
          ${script}
          postMessage({ type: 'result', output: __output.join('\\n'), error: '' });
        } catch (e) {
          postMessage({ type: 'result', output: __output.join('\\n'), error: e?.message ?? String(e) });
        }
        `;
}

function runInlineWorkerSession(
  blobUrl: string,
  timeoutMs: number,
  tenantId: string,
): Promise<IExecutionResult> {
  const outputChunks: string[] = [];
  const errorChunks: string[] = [];

  return new Promise<IExecutionResult>((resolve) => {
    let settled = false;
    const worker = new Worker(blobUrl);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
      resolve({
        status: "timeout",
        output: outputChunks.join("\n"),
        error: `Execution timed out after ${timeoutMs}ms`,
        metadata: { tenantId, timeout: timeoutMs },
      });
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent) => {
      if (settled) return;
      const data = event.data as {
        type: string;
        output: string;
        error: string;
      };
      if (data.type === "result") {
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(blobUrl);
        outputChunks.push(data.output);
        if (data.error) errorChunks.push(data.error);
        resolve({
          status: data.error ? "failed" : "completed",
          output: outputChunks.join("\n"),
          error: errorChunks.join("\n"),
          metadata: { tenantId, execMode: "js-inline" },
        });
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
      resolve({
        status: "failed",
        output: outputChunks.join("\n"),
        error: event.message ?? "Worker error",
        metadata: { tenantId, execMode: "js-inline" },
      });
    };
  });
}

@Injectable()
export class JsInlineExecutor implements IScheduleExecutor {
  async execute(
    schedule: ISchedule,
    tenantId: string,
  ): Promise<IExecutionResult> {
    const config = schedule.config;
    const script = config.script as string;
    const timeout = (config.timeout as number) || SCHEDULER_DEFAULT_TIMEOUT_MS;

    const blob = new Blob([buildInlineWorkerSource(script)], {
      type: "application/javascript",
    });
    const url = URL.createObjectURL(blob);
    return runInlineWorkerSession(url, timeout, tenantId);
  }
}
