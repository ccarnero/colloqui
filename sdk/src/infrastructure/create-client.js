import { resolveConfig } from "./config.js";
import { createSystemClock } from "./system-clock.js";
import { createAuthAdapter } from "./auth-adapter.js";
import { createChannelDirectoryAdapter } from "./channel-directory-adapter.js";
import { createIngestAdapter } from "./ingest-adapter.js";
import { createIngestClient } from "../application/ingest-client.js";
import { ConfigError } from "../domain/errors.js";

/**
 * Composition root. Resolves config, wires the real HTTP adapters, and returns the
 * ingest client ({ send, sendText }).
 *
 * @param {object} [userConfig] see README for fields. `fetch` and `clock` are injectable for tests.
 * @returns {{ send: Function, sendText: Function }}
 */
export function createClient(userConfig = {}) {
  const config = resolveConfig(userConfig);

  const fetchImpl = userConfig.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ConfigError(
      "global fetch is unavailable; use Node >=18 or pass `fetch` in config",
    );
  }
  const clock = userConfig.clock ?? createSystemClock();
  const { baseUrl, timeoutMs } = config;

  const ports = {
    auth: createAuthAdapter({ fetchImpl, baseUrl, timeoutMs, clock }),
    channelDirectory: createChannelDirectoryAdapter({ fetchImpl, baseUrl, timeoutMs }),
    ingest: createIngestAdapter({ fetchImpl, baseUrl, timeoutMs }),
  };

  return createIngestClient({ ports, config, clock });
}
