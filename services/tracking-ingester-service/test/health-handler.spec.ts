import { describe, expect, it } from "bun:test";
import {
  buildHealthResponse,
  type ReadinessState,
} from "../src/lib/health-handler.js";

const READY: ReadinessState = {
  natsConnected: true,
  postgresConnected: true,
  consumersStarted: true,
};

describe("buildHealthResponse — readiness semantics", () => {
  it("returns 200 ok only when every component is up", () => {
    const health = buildHealthResponse(READY);
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");
    expect(health.body.checks).toEqual(READY);
  });

  it("returns 503 unavailable when NATS is down", () => {
    const health = buildHealthResponse({ ...READY, natsConnected: false });
    expect(health.status).toBe(503);
    expect(health.body.status).toBe("unavailable");
    expect(health.body.checks.natsConnected).toBe(false);
  });

  it("returns 503 unavailable when Postgres is down", () => {
    const health = buildHealthResponse({ ...READY, postgresConnected: false });
    expect(health.status).toBe(503);
    expect(health.body.status).toBe("unavailable");
    expect(health.body.checks.postgresConnected).toBe(false);
  });

  it("returns 503 unavailable before consumers have started", () => {
    const health = buildHealthResponse({ ...READY, consumersStarted: false });
    expect(health.status).toBe(503);
    expect(health.body.status).toBe("unavailable");
    expect(health.body.checks.consumersStarted).toBe(false);
  });

  it("returns 503 when nothing is up (cold start)", () => {
    const health = buildHealthResponse({
      natsConnected: false,
      postgresConnected: false,
      consumersStarted: false,
    });
    expect(health.status).toBe(503);
    expect(health.body.status).toBe("unavailable");
  });

  it("echoes the per-check flags so the failing component is visible", () => {
    const state: ReadinessState = {
      natsConnected: true,
      postgresConnected: false,
      consumersStarted: true,
    };
    const health = buildHealthResponse(state);
    expect(health.body.checks).toEqual(state);
  });
});
