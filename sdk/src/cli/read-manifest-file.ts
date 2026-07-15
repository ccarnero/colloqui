import { readFileSync } from "node:fs";
import { err, ok, type Result } from "../lib/result.js";
import { CliError } from "./cli-error.js";

/**
 * Minimal shape of Bun's built-in YAML parser (`Bun.YAML.parse`), typed
 * locally since `bun-types` is not a dependency of this package.
 */
interface BunYamlGlobal {
  YAML?: { parse(input: string): unknown };
}

/**
 * Reads and parses a manifest file (`-f <file>`) from disk. YAML parsing
 * uses Bun's built-in `Bun.YAML.parse` — the SDK has no YAML-parsing
 * dependency (see `resources/manifests/types.ts` header) and decision 9
 * bounds this CLI to "no new deps beyond arg parsing", so this deliberately
 * relies on the Bun runtime rather than adding `js-yaml`. The `yoizen` bin
 * is invoked via `bunx`/`bun run` (see `sdk/README.md`), never plain
 * `node`, so this is not an extra runtime requirement in practice.
 *
 * Never throws: every failure (missing file, invalid YAML, non-object
 * result, missing Bun runtime) is returned as `Result.error`.
 */
export function readManifestFile(
  path: string
): Result<Record<string, unknown>, CliError> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    return err(
      new CliError(`could not read manifest file '${path}'`, { cause })
    );
  }

  const bunYaml = (globalThis as { Bun?: BunYamlGlobal }).Bun?.YAML;
  if (!bunYaml || typeof bunYaml.parse !== "function") {
    return err(
      new CliError(
        "the yoizen CLI requires the Bun runtime to parse YAML manifests (Bun.YAML) — run via `bunx yoizen` or `bun run bin/yoizen.ts`, not plain Node"
      )
    );
  }

  let parsed: unknown;
  try {
    parsed = bunYaml.parse(raw);
  } catch (cause) {
    return err(
      new CliError(`manifest file '${path}' is not valid YAML`, { cause })
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err(
      new CliError(
        `manifest file '${path}' must parse to a YAML/JSON object (got ${Array.isArray(parsed) ? "an array" : typeof parsed})`
      )
    );
  }

  return ok(parsed as Record<string, unknown>);
}
