import { parseArgs } from "node:util";
import type { Client } from "../infrastructure/create-client.js";
import { runApplyCommand } from "./commands/apply-command.js";
import { runPlanCommand } from "./commands/plan-command.js";
import { runValidateCommand } from "./commands/validate-command.js";
import { formatErrorDetail } from "./format-error-detail.js";
import { formatVerdictTable } from "./format-verdict-table.js";
import type { readManifestFile } from "./read-manifest-file.js";

export interface HandleManifestsCommandDeps {
  sub: string;
  args: string[];
  client: Pick<Client, "manifests" | "secrets">;
  env: Record<string, string | undefined>;
  readManifest: typeof readManifestFile;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/**
 * Dispatches `yoizen manifests validate|plan|apply -f <file> [--secrets-from-env]`.
 * Uses `node:util.parseArgs` (Node/Bun built-in) — decision 9 bounds this
 * CLI to "no new deps beyond arg parsing", so no `commander`/`yargs`.
 * Returns the process exit code (0 success, 1 failure) — never calls
 * `process.exit` itself so the bin entrypoint stays the single place doing
 * process-level side effects (see `bin/yoizen.ts`).
 */
export async function handleManifestsCommand({
  sub,
  args,
  client,
  env,
  readManifest,
  stdout,
  stderr,
}: HandleManifestsCommandDeps): Promise<number> {
  if (sub !== "validate" && sub !== "plan" && sub !== "apply") {
    stderr(`yoizen manifests: unknown subcommand '${sub}'`);
    stderr(
      "usage: yoizen manifests validate|plan|apply -f <file> [--secrets-from-env]"
    );
    return 1;
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        file: { type: "string", short: "f" },
        "secrets-from-env": { type: "boolean", default: false },
      },
      allowPositionals: false,
    });
  } catch (cause) {
    stderr(
      `yoizen manifests ${sub}: invalid arguments — ${(cause as Error).message}`
    );
    return 1;
  }

  const file = parsed.values.file as string | undefined;
  if (!file) {
    stderr(`yoizen manifests ${sub}: -f/--file <manifest.yaml> is required`);
    return 1;
  }

  stderr(`yoizen manifests ${sub}: reading manifest file '${file}'`);
  const manifestResult = readManifest(file);
  if (!manifestResult.ok) {
    stderr(`yoizen manifests ${sub}: ${manifestResult.error.message}`);
    return 1;
  }
  const manifest = manifestResult.value;

  if (sub === "validate") {
    const result = await runValidateCommand({ client, manifest, log: stderr });
    if (!result.ok) {
      stderr(`yoizen manifests validate: ${result.error.message}`);
      return 1;
    }
    if (!result.value.valid) {
      stdout("INVALID");
      for (const validationError of result.value.errors) {
        stdout(`  ${validationError.path}: ${validationError.message}`);
      }
      return 1;
    }
    stdout("VALID");
    return 0;
  }

  if (sub === "plan") {
    const result = await runPlanCommand({ client, manifest, log: stderr });
    if (!result.ok) {
      stderr(`yoizen manifests plan: ${result.error.message}`);
      for (const line of formatErrorDetail(result.error)) {
        stderr(line);
      }
      return 1;
    }
    stdout(
      formatVerdictTable(
        result.value.resources.map((resource) => ({
          kind: resource.kind,
          name: resource.name,
          verdict: resource.verdict,
        }))
      )
    );
    if (result.value.preconditions.length > 0) {
      stdout("");
      stdout("PRECONDITIONS:");
      for (const precondition of result.value.preconditions) {
        stdout(
          `  ${precondition.kind} ${precondition.resourceKind}/${precondition.resourceName}: ${precondition.message}`
        );
      }
    }
    return 0;
  }

  // sub === "apply"
  const secretsFromEnv = Boolean(parsed.values["secrets-from-env"]);
  const result = await runApplyCommand({
    client,
    manifest,
    secretsFromEnv,
    env,
    log: stderr,
  });
  if (!result.ok) {
    stderr(`yoizen manifests apply: ${result.error.message}`);
    for (const line of formatErrorDetail(result.error)) {
      stderr(line);
    }
    return 1;
  }
  stdout(
    formatVerdictTable(
      result.value.resources.map((resource) => ({
        kind: resource.kind,
        name: resource.name,
        verdict: resource.verdict,
      }))
    )
  );
  return 0;
}
