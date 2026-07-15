import { parseArgs } from "node:util";
import type { Client } from "../infrastructure/create-client.js";
import { runSecretsPutCommand } from "./commands/secrets-put-command.js";
import { parseScopeArg } from "./parse-scope-arg.js";

export interface HandleSecretsCommandDeps {
  sub: string;
  args: string[];
  client: Pick<Client, "secrets">;
  env: Record<string, string | undefined>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/**
 * Dispatches `yoizen secrets put <name> --scope <kind>:<owner> --value-env <VAR>`.
 * The secret VALUE is read from the env var named by `--value-env` — it
 * never appears in argv (satisfying "secret values never touch disk or
 * argv") and is passed straight to `client.secrets.set()`, never logged.
 */
export async function handleSecretsCommand({
  sub,
  args,
  client,
  env,
  stdout,
  stderr,
}: HandleSecretsCommandDeps): Promise<number> {
  if (sub !== "put") {
    stderr(`yoizen secrets: unknown subcommand '${sub}'`);
    stderr(
      "usage: yoizen secrets put <name> --scope <kind>:<owner> --value-env <VAR>"
    );
    return 1;
  }

  const [name, ...rest] = args;
  if (!name) {
    stderr("yoizen secrets put: <name> is required");
    return 1;
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        scope: { type: "string" },
        "value-env": { type: "string" },
      },
      allowPositionals: false,
    });
  } catch (cause) {
    stderr(
      `yoizen secrets put: invalid arguments — ${(cause as Error).message}`
    );
    return 1;
  }

  const scopeRaw = parsed.values.scope as string | undefined;
  const valueEnvVar = parsed.values["value-env"] as string | undefined;

  if (!scopeRaw) {
    stderr("yoizen secrets put: --scope <kind>:<owner> is required");
    return 1;
  }
  if (!valueEnvVar) {
    stderr("yoizen secrets put: --value-env <VAR> is required");
    return 1;
  }

  const scopeResult = parseScopeArg(scopeRaw);
  if (!scopeResult.ok) {
    stderr(`yoizen secrets put: ${scopeResult.error.message}`);
    return 1;
  }

  const value = env[valueEnvVar];
  if (value === undefined || value === "") {
    stderr(
      `yoizen secrets put: environment variable '${valueEnvVar}' is not set`
    );
    return 1;
  }

  const result = await runSecretsPutCommand({
    client,
    name,
    scope: scopeResult.value,
    value,
    log: stderr,
  });
  if (!result.ok) {
    stderr(`yoizen secrets put: ${result.error.message}`);
    return 1;
  }

  stdout(
    `secret '${name}' stored (scope=${scopeResult.value.kind}:${scopeResult.value.owner})`
  );
  return 0;
}
