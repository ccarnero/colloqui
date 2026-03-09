import { Injectable, Logger } from '@nestjs/common';
import { SCHEDULER_DEFAULT_TIMEOUT_MS } from '@yoizen/shared';
import type { ScheduleExecutor } from './executor.interface';
import type { Schedule } from '../modules/schedules/schedules.service';
import type { ExecutionResult } from '../engine/engine.service';

@Injectable()
export class JsInlineExecutor implements ScheduleExecutor {
  private readonly logger = new Logger(JsInlineExecutor.name);

  async execute(schedule: Schedule, tenantId: string): Promise<ExecutionResult> {
    const config = schedule.config;
    const script = config.script as string;
    const timeout = (config.timeout as number) || SCHEDULER_DEFAULT_TIMEOUT_MS;

    const outputChunks: string[] = [];
    const errorChunks: string[] = [];

    const blob = new Blob(
      [
        `
        const __output = [];
        const __originalLog = console.log;
        const __originalError = console.error;
        console.log = (...args) => { __output.push(args.map(String).join(' ')); };
        console.error = (...args) => { __output.push('[ERR] ' + args.map(String).join(' ')); };
        try {
          ${script}
          postMessage({ type: 'result', output: __output.join('\\n'), error: '' });
        } catch (e) {
          postMessage({ type: 'result', output: __output.join('\\n'), error: e?.message ?? String(e) });
        }
        `,
      ],
      { type: 'application/javascript' },
    );

    const url = URL.createObjectURL(blob);

    return new Promise<ExecutionResult>((resolve) => {
      let settled = false;
      const worker = new Worker(url);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({
          status: 'timeout',
          output: outputChunks.join('\n'),
          error: `Execution timed out after ${timeout}ms`,
          metadata: { tenantId, timeout },
        });
      }, timeout);

      worker.onmessage = (event: MessageEvent) => {
        if (settled) return;
        const data = event.data as { type: string; output: string; error: string };
        if (data.type === 'result') {
          settled = true;
          clearTimeout(timer);
          worker.terminate();
          URL.revokeObjectURL(url);
          outputChunks.push(data.output);
          if (data.error) errorChunks.push(data.error);
          resolve({
            status: data.error ? 'failed' : 'completed',
            output: outputChunks.join('\n'),
            error: errorChunks.join('\n'),
            metadata: { tenantId, execMode: 'js-inline' },
          });
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({
          status: 'failed',
          output: outputChunks.join('\n'),
          error: event.message ?? 'Worker error',
          metadata: { tenantId, execMode: 'js-inline' },
        });
      };
    });
  }
}
