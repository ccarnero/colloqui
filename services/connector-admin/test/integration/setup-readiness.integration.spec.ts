/**
 * Regression: container readiness contract of the Phase-6 integration
 * harness (`./setup.ts`).
 *
 * RCA — the Phase-6 specs failed intermittently (~2 in 5 full-suite
 * runs) with `NatsError: CONNECTION_REFUSED` / `ECONNREFUSED` raised
 * from `beforeAll` (bun labels a failing hook `(unnamed)`, which is why
 * the failure looked like it came from the shutdown assertions). Cause:
 * `startNatsTestcontainer()` waited only for the broker's readiness LINE
 * in the container log, which the process inside the container emits
 * before the runtime has published the host-side port mapping. Dialing
 * the mapped port on the very next tick therefore raced the proxy —
 * locally the port was not connectable on the first probe in 5 of 6
 * container boots.
 *
 * This spec pins the fixed contract: when `startNatsTestcontainer()`
 * resolves, the mapped host port MUST already accept a connection on
 * the FIRST attempt — no retry, no sleep, no reconnect window. Against
 * the pre-fix harness this test fails the majority of runs.
 *
 * Requires Docker.
 */

import "reflect-metadata";
import { describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  connectNats,
  isPortConnectable,
  type NatsTestcontainer,
  startNatsTestcontainer,
} from "./setup";

const HAS_DOCKER = (() => {
  try {
    Bun.file("/var/run/docker.sock").size;
    return true;
  } catch {
    return Boolean(process.env.DOCKER_HOST);
  }
})();

const describeIfDocker = HAS_DOCKER ? describe : describe.skip;

/**
 * Bun's lifecycle hooks reject a per-hook timeout argument
 * (`beforeAll(fn, ms)` throws at module load), so the container-boot
 * budget is declared file-wide — same ceiling the sibling specs use.
 */
setDefaultTimeout(120_000);

describeIfDocker(
  "Integration harness container readiness — requires docker",
  () => {
    it("startNatsTestcontainer() resolves only once the mapped host port accepts the FIRST connect attempt", async () => {
      let natsTc: NatsTestcontainer | undefined;
      try {
        natsTc = await startNatsTestcontainer();

        // Single, un-retried probe: this is the exact operation that
        // every sibling spec's `beforeAll` performs implicitly.
        expect(await isPortConnectable(natsTc.host, natsTc.port)).toBe(true);

        // And the real client handshake must also succeed first try —
        // `connect()` does NOT retry the initial dial, so an unready
        // port surfaces as CONNECTION_REFUSED right here.
        const clients = await connectNats(natsTc.url);
        expect(clients.nc.isClosed()).toBe(false);
        await clients.nc.close();
      } finally {
        await natsTc?.stop();
      }
    });
  }
);
