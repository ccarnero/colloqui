#!/usr/bin/env bun
import { runCli } from "../src/cli/run-cli.js";
/**
 * `yoizen` CLI entrypoint (`manual-loops/samples-reorg.md` T05, decision 9).
 *
 * Requires the Bun runtime — `bunx yoizen ...` or `bun run bin/yoizen.ts ...`
 * — because manifest files are YAML and this CLI parses them with Bun's
 * built-in `Bun.YAML.parse` rather than adding a `js-yaml` dependency (see
 * `src/cli/read-manifest-file.ts`). Not executable directly by plain
 * `node`.
 *
 * Auth/config resolution is IDENTICAL to every other SDK consumer:
 * `createClient()` resolves `YOIZEN_TENANT`/`YOIZEN_EMAIL`/`YOIZEN_PASSWORD`/
 * `YOIZEN_BASE_URL` (same precedence as `src/infrastructure/config.ts`) —
 * this file does not duplicate that logic, it just calls `createClient()`.
 */
import { createClient } from "../src/infrastructure/create-client.js";

async function main(): Promise<number> {
  let client: ReturnType<typeof createClient>;
  try {
    client = createClient();
  } catch (cause) {
    console.error(`yoizen: ${(cause as Error).message}`);
    return 1;
  }

  return runCli({ argv: process.argv.slice(2), client });
}

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((cause: unknown) => {
    console.error(`yoizen: unexpected failure — ${String(cause)}`);
    process.exit(1);
  });
