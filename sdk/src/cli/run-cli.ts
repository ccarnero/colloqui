import type { Client } from "../infrastructure/create-client.js";
import { handleManifestsCommand } from "./handle-manifests-command.js";
import { handleSecretsCommand } from "./handle-secrets-command.js";
import { readManifestFile } from "./read-manifest-file.js";

export interface RunCliDeps {
  /** `process.argv.slice(2)` in production; a literal array in tests. */
  argv: string[];
  client: Pick<Client, "manifests" | "secrets">;
  env?: Record<string, string | undefined>;
  /** Injectable for tests — defaults to the real file-reading + Bun-YAML implementation. */
  readManifest?: typeof readManifestFile;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

const USAGE = [
  "usage: yoizen manifests validate|plan|apply -f <file> [--secrets-from-env]",
  "       yoizen secrets put <name> --scope <kind>:<owner> --value-env <VAR>",
];

/**
 * Top-level `yoizen` CLI router (decision 9,
 * `manual-loops/samples-reorg.md` T05). Thin command layer over
 * `client.manifests`/`client.secrets` — no new SDK API surface. Returns the
 * process exit code; the bin entrypoint (`bin/yoizen.ts`) is the only place
 * that calls `process.exit`.
 */
export async function runCli({
  argv,
  client,
  env = process.env,
  readManifest = readManifestFile,
  stdout = (line: string) => {
    console.log(line);
  },
  stderr = (line: string) => {
    console.error(line);
  },
}: RunCliDeps): Promise<number> {
  const [group, sub, ...rest] = argv;

  if (group === "manifests" && sub !== undefined) {
    return handleManifestsCommand({
      sub,
      args: rest,
      client,
      env,
      readManifest,
      stdout,
      stderr,
    });
  }

  if (group === "secrets" && sub !== undefined) {
    return handleSecretsCommand({
      sub,
      args: rest,
      client,
      env,
      stdout,
      stderr,
    });
  }

  stderr(`yoizen: unknown command '${argv.join(" ")}'`);
  for (const line of USAGE) {
    stderr(line);
  }
  return 1;
}
