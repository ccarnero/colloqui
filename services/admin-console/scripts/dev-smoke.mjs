#!/usr/bin/env node
// Dev-mode smoke gate (G5a): boots `ng serve`, waits until the SPA shell is
// served, then shuts down. Exit 0 = app boots and serves index with <app-root>.
// Used by the manual-loop SPECs as a runtime-boot check that unit tests and
// the production build cannot provide.
import { spawn } from "node:child_process";

const PORT = process.env.DEV_SMOKE_PORT ?? "4299";
const TIMEOUT_MS = Number(process.env.DEV_SMOKE_TIMEOUT_MS ?? 180_000);
const POLL_MS = 2_000;
const URL = `http://localhost:${PORT}/`;

const log = (msg) => console.log(`[dev-smoke] ${msg}`);

log(`starting ng serve on port ${PORT} (timeout ${TIMEOUT_MS}ms)`);
const child = spawn(
  "pnpm",
  ["exec", "ng", "serve", "--port", PORT, "--no-open", "--no-live-reload"],
  { stdio: ["ignore", "pipe", "pipe"], detached: true },
);
child.stdout.on("data", (d) => process.stdout.write(`[ng] ${d}`));
child.stderr.on("data", (d) => process.stderr.write(`[ng] ${d}`));

let finished = false;
const shutdown = (code, reason) => {
  if (finished) return;
  finished = true;
  log(`${reason} — shutting down ng serve (exit ${code})`);
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (err) {
    log(`kill failed (already dead?): ${err.message}`);
  }
  // Give the process group a moment to die before exiting.
  setTimeout(() => process.exit(code), 1_500);
};

child.on("exit", (code) => {
  if (!finished) shutdown(1, `ng serve exited early with code ${code}`);
});

const deadline = Date.now() + TIMEOUT_MS;
const poll = async () => {
  if (finished) return;
  if (Date.now() > deadline) {
    shutdown(1, `timed out after ${TIMEOUT_MS}ms waiting for ${URL}`);
    return;
  }
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(POLL_MS) });
    const body = await res.text();
    if (res.ok && body.includes("<app-root")) {
      shutdown(0, `OK — ${URL} responded ${res.status} with <app-root>`);
      return;
    }
    log(`not ready yet: status ${res.status}, app-root=${body.includes("<app-root")}`);
  } catch {
    // Server not accepting connections yet — keep polling.
  }
  setTimeout(poll, POLL_MS);
};
setTimeout(poll, POLL_MS);
