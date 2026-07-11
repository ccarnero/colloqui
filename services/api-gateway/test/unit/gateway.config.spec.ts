import { describe, expect, it } from "bun:test";
import { gatewayConfig } from "../../src/config/gateway.config";

// T03 of manual-loops/trace-console.md: the tracking-ingester-worker is a
// plain Deployment + ClusterIP Service listening on port 3000, unlike the
// Knative ksvc targets (port 80) used by every other gatewayConfig.services
// entry. Without an explicit port, the gateway proxy hangs connecting to
// port 80 and times out after 30s. This test guards the default (no
// TRACKING_SERVICE_URL override) resolves to port 3000.
//
// `gatewayConfig` is a plain object evaluated once at first import (not a
// `registerAs`/factory function), so `process.env.TRACKING_SERVICE_URL` must
// already be set by the time the process first imports this module. Under
// `bun test` (full suite) the module is imported once, before any test file
// body runs, so per-test overrides of `TRACKING_SERVICE_URL` have no effect
// on the already-resolved `gatewayConfig.services.tracking` value. We assert
// against whatever `TRACKING_SERVICE_URL` was in the environment at process
// start (unset in this suite), rather than mutating env inside the test.
describe("gatewayConfig.services.tracking", () => {
  it("defaults to the tracking-ingester-worker ClusterIP Service on port 3000 when TRACKING_SERVICE_URL is unset", () => {
    expect(process.env.TRACKING_SERVICE_URL).toBeUndefined();
    expect(gatewayConfig.services.tracking).toContain(
      "tracking-ingester-worker"
    );
    expect(gatewayConfig.services.tracking).toMatch(/:3000$/);
  });
});
