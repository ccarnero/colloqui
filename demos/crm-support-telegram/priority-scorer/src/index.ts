/**
 * priority-scorer entrypoint — boots the `@yoizen/platform-sdk` client (auth
 * happens transparently on first request, same as every other demo script)
 * and starts `Bun.serve()` on `process.env.PORT` (Knative-injected; NEVER
 * set/override it — SPEC T05 constraint).
 */
import { createClient } from "@yoizen/platform-sdk";
import { loadConfig } from "./config.js";
import { log, step } from "./lib/logging.js";
import { buildHandler, type ScorerClient } from "./server.js";

const config = loadConfig();

step(
  `priority-scorer starting: tenant=${config.yoizenTenant} baseUrl=${config.yoizenBaseUrl} port=${config.port}`
);

const client = createClient({
  tenant: config.yoizenTenant,
  email: config.yoizenEmail,
  password: config.yoizenPassword,
  baseUrl: config.yoizenBaseUrl,
}) as unknown as ScorerClient;

const handle = buildHandler(client, config);

Bun.serve({
  port: config.port,
  fetch: handle,
});

log(`priority-scorer listening on :${config.port}`);
