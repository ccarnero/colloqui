import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { PinoLoggerService } from "./logger";
import { shutdownTelemetry } from "./telemetry";
import {
  startWorkerHealthServer,
  type IWorkerHealthServer,
} from "./worker-health-server";

export interface IBootstrapWorkerOptions {
  serviceName: string;
  module: unknown;
  /**
   * Port for the readiness/liveness probe HTTP server.
   *
   * Defaults to 3000 — matching the `httpGet.port: 3000` declared in
   * `knative/services/base/<svc>-worker.yaml`. Set to a falsy value to
   * disable (e.g. for unit tests that import the bootstrap helper).
   */
  healthPort?: number;
}

/**
 * Bootstraps a Nest application context (no HTTP API server) for worker pods,
 * plus a tiny Node-native readiness server on `healthPort` so kubelet can mark
 * the pod `Ready`.
 *
 * Worker pods run at a fixed replica count and only need the IoC container
 * alive to run NATS consumers wired via `OnModuleInit`. Skipping
 * Fastify keeps the worker memory profile ~20MB lower vs. the API pod and
 * avoids the NestJS/Fastify HTTP stack overhead — but the kubelet still
 * requires *some* HTTP listener answering 200 on the configured probe path,
 * so we ship `worker-health-server.ts` (≈4KB, zero deps).
 *
 * Hot-path note: the returned context is kept open via a single SIGTERM
 * handler (no busy-loop, no setInterval).
 */
export interface IBootstrappedWorker {
  app: INestApplicationContext;
  healthServer: IWorkerHealthServer | null;
}

export async function bootstrapWorkerApp(
  options: IBootstrapWorkerOptions,
): Promise<IBootstrappedWorker> {
  const logger = new PinoLoggerService(options.serviceName);

  // Bind the health socket BEFORE Nest init so kubelet probes get a clean
  // HTTP 503 (NotReady) during NATS/DB/consumer wiring instead of TCP
  // ECONNREFUSED. `setReady(true)` is flipped only after `app.init()`
  // resolves successfully — until then the server answers 503 on every
  // health path (O(1) per request, see worker-health-server.ts).
  const healthPort = options.healthPort ?? 3000;
  const healthServer: IWorkerHealthServer | null =
    healthPort > 0 ? startWorkerHealthServer(healthPort) : null;
  if (healthServer !== null) {
    logger.log(
      `Worker health server listening on :${healthPort} (/health, /healthz, /readyz) — answering 503 until init completes`,
    );
  }

  try {
    const app = await NestFactory.createApplicationContext(
      options.module as Parameters<
        typeof NestFactory.createApplicationContext
      >[0],
      { logger },
    );
    await app.init();

    if (healthServer !== null) {
      healthServer.setReady(true);
    }

    logger.log(`Worker context ready for ${options.serviceName}`);
    return { app, healthServer };
  } catch (err) {
    if (healthServer !== null) {
      await healthServer.close();
    }
    throw err;
  }
}

/**
 * Worker-mode SIGTERM handler: flips readiness to false (kubelet stops
 * routing while we drain), closes the Nest context (triggering
 * OnModuleDestroy on consumers — which drain inflight messages and ack them
 * before exit), shuts the health socket, flushes telemetry, then exits 0.
 */
export function registerWorkerShutdownHandler(
  bootstrap: IBootstrappedWorker | INestApplicationContext,
): void {
  const isBootstrapped = (
    value: IBootstrappedWorker | INestApplicationContext,
  ): value is IBootstrappedWorker =>
    typeof (value as IBootstrappedWorker).app !== "undefined" &&
    "healthServer" in (value as IBootstrappedWorker);

  const app = isBootstrapped(bootstrap) ? bootstrap.app : bootstrap;
  const healthServer = isBootstrapped(bootstrap) ? bootstrap.healthServer : null;

  let closing = false;
  process.on("SIGTERM", async () => {
    if (closing) return;
    closing = true;
    try {
      if (healthServer !== null) {
        healthServer.setReady(false);
      }
      await app.close();
    } finally {
      if (healthServer !== null) {
        await healthServer.close();
      }
      await shutdownTelemetry();
      process.exit(0);
    }
  });
}

/**
 * Convenience runner mirroring `runNestFastifyServiceMain` for worker pods.
 * Logs and exits 1 on bootstrap failure.
 */
export function runNestWorkerServiceMain(
  serviceName: string,
  bootstrap: () => Promise<IBootstrappedWorker | INestApplicationContext>,
): void {
  void bootstrap()
    .then((result) => {
      registerWorkerShutdownHandler(result);
    })
    .catch((err: unknown) => {
      const logger = new PinoLoggerService(serviceName);
      const detail =
        err instanceof Error
          ? `${err.name}: ${err.message}`
          : typeof err === "string"
            ? err
            : JSON.stringify(err);
      const stack = err instanceof Error ? err.stack : undefined;
      logger.error(`Worker bootstrap failed — ${detail}`, stack ?? detail);
      process.exit(1);
    });
}
