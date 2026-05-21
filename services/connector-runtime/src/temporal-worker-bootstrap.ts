import {
  NativeConnection,
  Runtime,
  Worker,
  type WorkerOptions,
} from "@temporalio/worker";
import { PinoLoggerService, shutdownTelemetry } from "@yoizen/observability";
import { startTemporalWorkerHealthServer } from "./temporal-worker-health";

/**
 * Install Temporal Core SDK metrics exporter at module load when
 * `PROMETHEUS_BIND_ADDRESS` is provided. The Temporal TS SDK exposes
 * `temporal_*` metrics (workflow_task_schedule_to_start_latency,
 * activity_task_schedule_to_start_latency, sticky_cache_hit/miss,
 * worker_task_slots_available_total, etc.) which are essential to
 * diagnose backpressure under load.
 *
 * Runtime.install MUST be called before any `NativeConnection.connect`
 * or `Worker.create` and only once per process — running this at
 * top-level module load (before `runTemporalWorkerCli` is invoked)
 * satisfies both constraints. O(1).
 */
const prometheusBindAddress = process.env.PROMETHEUS_BIND_ADDRESS;
if (prometheusBindAddress && prometheusBindAddress.length > 0) {
  Runtime.install({
    telemetryOptions: {
      metrics: {
        prometheus: { bindAddress: prometheusBindAddress },
      },
    },
  });
}

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
   * When true, SIGINT/SIGTERM call `process.exit(0)` after shutdown (HTTP worker style).
   * When false, handlers invoke shutdown without exiting (orchestrator style).
   */
  readonly exitOnSignal?: boolean;
}

/**
 * Boots health server, connects to Temporal, runs worker, registers shutdown.
 * O(1) setup; blocks on `worker.run()`.
 */
export async function runTemporalWorkerMain(
  options: IRunTemporalWorkerOptions,
): Promise<void> {
  const health = startTemporalWorkerHealthServer(options.port);
  const connection = await NativeConnection.connect({
    address: options.temporalAddress,
  });
  const worker = await Worker.create({
    connection,
    ...options.workerOptions,
  });
  health.setHealthy(true);
  options.logger.log(options.startupMessage);

  const shutdown = async (): Promise<void> => {
    health.setHealthy(false);
    options.logger.log(options.shutdownMessage);
    worker.shutdown();
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

  await worker.run();
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
