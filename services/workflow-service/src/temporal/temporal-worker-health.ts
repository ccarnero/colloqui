import { createServer, type Server } from "http";

export interface ITemporalWorkerHealthServer {
  readonly server: Server;
  setHealthy(value: boolean): void;
}

/**
 * Minimal HTTP health server for Temporal worker processes (readiness before
 * worker is ready, 503 until `setHealthy(true)`).
 */
export function startTemporalWorkerHealthServer(
  port: number,
): ITemporalWorkerHealthServer {
  let healthy = false;
  const server = createServer((_req, res) => {
    const status = healthy ? 200 : 503;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: healthy ? "ok" : "starting" }));
  });
  server.listen(port, "0.0.0.0");
  return {
    server,
    setHealthy: (value: boolean) => {
      healthy = value;
    },
  };
}
