import { createServer, type Server } from "http";

/**
 * Minimal HTTP health server for `SERVICE_MODE=worker` pods (Phase 1.5).
 *
 * Plain Kubernetes Deployments exposed via KEDA need a `readinessProbe` so the
 * kubelet can report the pod as `Ready` (which gates rolling updates and
 * lets KEDA scale the deployment without traffic gaps). Workers don't run
 * Fastify, so we ship a tiny Node-native listener that answers `/health` and
 * `/readyz`. The footprint is one socket + one file descriptor.
 *
 * Performance contract (the entire request path):
 *   - O(1) per request — single switch on `req.url`, no allocations after
 *     the cached body bytes are computed once at construction.
 *   - No npm dependencies — uses `node:http` only.
 *   - No timer / interval — readiness flag flips on `setReady(true|false)`.
 */
export interface IWorkerHealthServer {
  readonly server: Server;
  /** Set readiness state. Call once with `true` after Nest `app.init()`. */
  setReady(value: boolean): void;
  /** Stop listening — invoked from the worker SIGTERM handler. */
  close(): Promise<void>;
}

const READY_BODY = Buffer.from('{"status":"ok"}');
const STARTING_BODY = Buffer.from('{"status":"starting"}');
const NOT_FOUND_BODY = Buffer.from('{"error":"not_found"}');

const READY_HEADERS = {
  "content-type": "application/json",
  "content-length": String(READY_BODY.length),
} as const;
const STARTING_HEADERS = {
  "content-type": "application/json",
  "content-length": String(STARTING_BODY.length),
} as const;
const NOT_FOUND_HEADERS = {
  "content-type": "application/json",
  "content-length": String(NOT_FOUND_BODY.length),
} as const;

/**
 * Starts the worker health server on `port` (default 3000) bound to all
 * interfaces. Both `/health` and `/readyz` answer 200 once `setReady(true)`
 * has been called and 503 before that (so kubelet keeps the pod
 * `NotReady` while NATS consumers are still wiring up in `OnModuleInit`).
 *
 * Any other path returns 404 to keep curl-based smoke tests honest.
 */
export function startWorkerHealthServer(port: number): IWorkerHealthServer {
  let ready = false;
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    const isHealthPath = url === "/health" || url === "/readyz";
    if (isHealthPath) {
      if (ready) {
        res.writeHead(200, READY_HEADERS);
        res.end(READY_BODY);
      } else {
        res.writeHead(503, STARTING_HEADERS);
        res.end(STARTING_BODY);
      }
      return;
    }
    res.writeHead(404, NOT_FOUND_HEADERS);
    res.end(NOT_FOUND_BODY);
  });

  server.listen(port, "0.0.0.0");

  return {
    server,
    setReady(value: boolean): void {
      ready = value;
    },
    close(): Promise<void> {
      return new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
}
