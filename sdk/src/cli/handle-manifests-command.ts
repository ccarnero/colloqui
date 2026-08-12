import { parseArgs } from "node:util";
import type { Client } from "../infrastructure/create-client.js";
import { runApplyCommand } from "./commands/apply-command.js";
import { runPlanCommand } from "./commands/plan-command.js";
import {
  buildUndeployPreview,
  runUndeployCommand,
} from "./commands/undeploy-command.js";
import { runValidateCommand } from "./commands/validate-command.js";
import { formatErrorDetail } from "./format-error-detail.js";
import {
  formatKbApplySection,
  formatKbPlanSection,
} from "./format-kb-section.js";
import { formatUndeployReport } from "./format-undeploy-report.js";
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
 * Dispatches
 * `yoizen manifests validate|plan|apply|undeploy -f <file> [--secrets-from-env] [--yes]`.
 * Uses `node:util.parseArgs` (Node/Bun built-in) — decision 9 bounds this
 * CLI to "no new deps beyond arg parsing", so no `commander`/`yargs`.
 * Returns the process exit code (0 success, 1 failure) — never calls
 * `process.exit` itself so the bin entrypoint stays the single place doing
 * process-level side effects (see `bin/yoizen.ts`).
 */
const MANIFESTS_USAGE = [
  "usage: yoizen manifests <subcommand> -f <file> [options]",
  "",
  "subcommands:",
  "  validate   check the manifest against the schema and live preconditions",
  "  plan       print the per-resource create|update|noop verdict table",
  "  apply      converge the cluster to the manifest (never deletes)",
  "  undeploy   delete the resources the STORED manifest owns (needs --yes)",
  "",
  "options:",
  "  -f, --file <manifest.yaml>   manifest to operate on (required)",
  "  --secrets-from-env           apply only: resolve each secret binding from",
  "                               the env var named like the binding, or its",
  "                               UPPER_SNAKE form (telegram-bot-token or",
  "                               TELEGRAM_BOT_TOKEN)",
  "  --yes                        undeploy only: confirm the deletion. Without",
  "                               it, undeploy only PREVIEWS what it would",
  "                               delete and exits 1 (no interactive prompt)",
  "  -h, --help                   show this help",
];

function subUsage(sub: string): string[] {
  const flags =
    sub === "apply"
      ? " [--secrets-from-env]"
      : sub === "undeploy"
        ? " [--yes]"
        : "";
  const extra =
    sub === "apply"
      ? [
          "  --secrets-from-env   resolve each secret binding from the env var",
          "                       named like the binding or its UPPER_SNAKE form",
        ]
      : sub === "undeploy"
        ? [
            "  --yes                confirm the deletion; without it undeploy only",
            "                       PREVIEWS what it would delete and exits 1",
          ]
        : [];
  return [`usage: yoizen manifests ${sub} -f <file>${flags}`, ...extra];
}

export async function handleManifestsCommand({
  sub,
  args,
  client,
  env,
  readManifest,
  stdout,
  stderr,
}: HandleManifestsCommandDeps): Promise<number> {
  if (sub === "--help" || sub === "-h" || sub === "help") {
    for (const line of MANIFESTS_USAGE) {
      stdout(line);
    }
    return 0;
  }

  if (
    sub !== "validate" &&
    sub !== "plan" &&
    sub !== "apply" &&
    sub !== "undeploy"
  ) {
    stderr(`yoizen manifests: unknown subcommand '${sub}'`);
    stderr(
      "usage: yoizen manifests validate|plan|apply|undeploy -f <file> [--secrets-from-env] [--yes] (see 'yoizen manifests --help')"
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
        // `undeploy` only (PENDIENTES/12-undeploy.spec.md T02): the
        // confirmation gate. A FLAG, never an interactive prompt — the CLI
        // runs in CI/e2e scripts with no TTY.
        yes: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
    });
  } catch (cause) {
    stderr(
      `yoizen manifests ${sub}: invalid arguments — ${(cause as Error).message}`
    );
    return 1;
  }

  if (parsed.values.help === true) {
    for (const line of subUsage(sub)) {
      stdout(line);
    }
    return 0;
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
    for (const line of formatKbPlanSection(result.value.knowledgeBases)) {
      stdout(line);
    }
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

  if (sub === "undeploy") {
    // The `--yes` gate (PENDIENTES/12-undeploy.spec.md T02): without it the
    // command PREVIEWS and refuses, calling nothing — the destructive verb
    // must never run on a bare `undeploy -f <file>`.
    if (parsed.values.yes !== true) {
      const preview = buildUndeployPreview(manifest);
      if (!preview.ok) {
        stderr(`yoizen manifests undeploy: ${preview.error.message}`);
        return 1;
      }
      stdout(formatVerdictTable(preview.value.rows));
      stderr("");
      stderr(
        `yoizen manifests undeploy: this would DELETE the resources above that manifest '${preview.value.name}' owns, in reverse dependency order (server-side). 'external (kept)' resources are never deleted.`
      );
      stderr(
        "yoizen manifests undeploy: the list comes from the FILE (declaration order); resources already gone report 'not_found' during the run."
      );
      stderr(
        `yoizen manifests undeploy: NOTHING was deleted — re-run with --yes to confirm: yoizen manifests undeploy -f ${file} --yes`
      );
      return 1;
    }

    const undeployResult = await runUndeployCommand({
      client,
      manifest,
      log: stderr,
    });
    if (!undeployResult.ok) {
      stderr(`yoizen manifests undeploy: ${undeployResult.error.message}`);
      for (const line of formatErrorDetail(undeployResult.error)) {
        stderr(line);
      }
      return 1;
    }
    if (undeployResult.value.kind === "already_absent") {
      // The server's 404: a fully successful run deletes the stored record
      // LAST, so a SECOND full undeploy lands here. Decision 6 — success.
      stdout(
        `already undeployed (nothing stored under '${undeployResult.value.name}')`
      );
      return 0;
    }
    for (const line of formatUndeployReport(undeployResult.value.report)) {
      stdout(line);
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
  for (const line of formatKbApplySection(result.value.knowledgeBases)) {
    stdout(line);
  }
  return 0;
}
