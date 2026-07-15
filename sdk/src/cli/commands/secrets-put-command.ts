import type { Client } from "../../infrastructure/create-client.js";
import { err, ok, type Result } from "../../lib/result.js";
import type {
  SecretScope,
  SecretWriteResult,
} from "../../resources/secrets/index.js";
import { CliError } from "../cli-error.js";

export interface SecretsPutCommandDeps {
  client: Pick<Client, "secrets">;
  name: string;
  scope: SecretScope;
  value: string;
  log?: (msg: string) => void;
}

/**
 * `yoizen secrets put <name> --scope <kind>:<owner> --value-env <VAR>` —
 * thin wrapper over `client.secrets.set()`. `value` arrives already resolved
 * from the env var named by `--value-env` (see `handle-secrets-command.ts`)
 * and is never logged (write-only guarantee, `resources/secrets/types.ts`).
 */
export async function runSecretsPutCommand({
  client,
  name,
  scope,
  value,
  log = () => {},
}: SecretsPutCommandDeps): Promise<Result<SecretWriteResult, CliError>> {
  log(
    `secrets put: PUT /provisioning/secrets/${name} scope=${scope.kind}:${scope.owner} (value never logged)`
  );
  try {
    const result = await client.secrets.set(name, value, scope);
    log(`secrets put: stored secret '${name}'`);
    return ok(result);
  } catch (cause) {
    return err(
      new CliError(`secrets put: failed to write secret '${name}'`, {
        cause,
      })
    );
  }
}
