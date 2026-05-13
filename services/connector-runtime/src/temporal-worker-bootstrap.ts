import { NativeConnection, Worker, type WorkerOptions } from "@temporalio/worker";
import { PinoLoggerService, shutdownTelemetry } from "@yoizen/observability";
import { startTemporalWorkerHealthServer } from "./temporal-worker-health";

/**
 * Options for {@link runTemporalWorkerMain}. Connection is created internally;
 * pass remaining `Worker.create` fields via `workerOptions`.
 */
export interface IRunTemporalWorkerOptions {
  readonly port: number;
  readonly temporalAddress: string;
  readonly workerOptions: Omit<WorkerOptions, "connection">;
  readonly logger: PinoLoggerService;
  readonly startupMessage: string;
  readonly shutdownMessage: string;
  /**
   * When set, a second worker polls this queue with the same activities and
   * workflows (empty workflow list for activity worker). Use during Temporal
   * task-queue renames to drain the legacy queue (e.g. `http-adapter`).
   */
  readonly legacyTaskQueue?: string;
  /**
   * When true, SIGINT/SIGTERM call `process.exit(0)` after shutdown (HTTP worker style).
   * When false, handlers invoke shutdown without exiting (orchestrator style).
   */
  readonly exitOnSignal?: boolean;
}

/**
 * Boots health server, connects to Temporal, runs worker(s), registers shutdown.
 * O(1) setup; blocks on `Promise.all` of `worker.run()`.
 */
export async function runTemporalWorkerMain(
  options: IRunTemporalWorkerOptions,
): Promise<void> {
  const health = startTemporalWorkerHealthServer(options.port);
  const connection = await NativeConnection.connect({
    address: options.temporalAddress,
  });

  const primary = await Worker.create({
    connection,
    ...options.workerOptions,
  });
  const workers: Worker[] = [primary];

  const legacy = options.legacyTaskQueue?.trim();
  if (legacy && legacy.length > 0 && legacy !== options.workerOptions.taskQueue) {
    const legacyWorker = await Worker.create({
      connection,
      ...options.workerOptions,
      taskQueue: legacy,
    });
    workers.push(legacyWorker);
    options.logger.log(
      `Also polling legacy Temporal task queue "${legacy}" (drain bridge)`,
    );
  }

  health.setHealthy(true);
  options.logger.log(options.startupMessage);

  const shutdown = async (): Promise<void> => {
    health.setHealthy(false);
    options.logger.log(options.shutdownMessage);
    for (const w of workers) {
      w.shutdown();
    }
    await shutdownTelemetry();
  };

  if (options.exitOnSignal) {
    const onSignal = (): void => {
      void shutdown().then(() => process.exit(0));
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  } else {
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }

  await Promise.all(workers.map((w) => w.run()));
}

/**
 * Starts {@link runTemporalWorkerMain} and exits the process with code 1 on failure.
 * Use as the worker entrypoint to avoid duplicating `main().catch` + `process.exit(1)`.
 */
export function runTemporalWorkerCli(
  options: IRunTemporalWorkerOptions,
  failureLogMessage: string,
): void {
  void runTemporalWorkerMain(options).catch((err: unknown) => {
    options.logger.error(
      failureLogMessage,
      err instanceof Error ? err.stack : String(err),
    );
    process.exit(1);
  });
}
