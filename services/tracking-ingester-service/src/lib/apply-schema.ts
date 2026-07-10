// Applies a list of DDL statements sequentially through a postgres.js client,
// mirroring the `SchemaInitializer` semantics in
// packages/database/src/postgres-provider.ts (each statement runs verbatim via
// `sql.unsafe`). Pure-ish: the only side effect is the injected client; the
// function itself derives nothing and never throws for an expected failure —
// a failing statement is returned as an `err`, not raised.
//
// The client is typed against a MINIMAL structural interface (`{ unsafe }`) so
// the logic stays decoupled from the concrete postgres.js `Sql` type and is
// trivially testable with a fake client.

import { err, ok, type Result } from "./result.js";

/** The single postgres.js capability this module needs: raw statement exec. */
export interface SchemaClient {
  unsafe(query: string): Promise<unknown>;
}

/** Outcome of a schema application: how many statements ran successfully. */
export interface ApplySchemaOk {
  applied: number;
}

/** Structured failure: which statement (0-based index) failed, and why. */
export interface ApplySchemaError {
  index: number;
  statement: string;
  reason: string;
}

/**
 * Runs `statements` in order via `client.unsafe`, stopping at the first
 * failure. Every statement is expected to be idempotent (CREATE ... IF NOT
 * EXISTS), so re-applying an already-applied schema is a no-op.
 *
 * @param client postgres.js client (or any `{ unsafe }` shape)
 * @param statements ordered DDL statements (see `loadSchemaStatements`)
 * @param log optional line logger for verbose progress (defaults to no-op)
 */
export async function applySchema(
  client: SchemaClient,
  statements: readonly string[],
  log: (message: string) => void = () => {}
): Promise<Result<ApplySchemaOk, ApplySchemaError>> {
  log(`applySchema: applying ${statements.length} statement(s)`);

  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]!;
    const preview = statement.replace(/\s+/g, " ").slice(0, 80);
    log(`applySchema: [${index + 1}/${statements.length}] ${preview}`);

    try {
      await client.unsafe(statement);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`applySchema: statement ${index + 1} FAILED — ${reason}`);
      return err<ApplySchemaError>({ index, statement, reason });
    }
  }

  log(`applySchema: complete — ${statements.length} statement(s) applied`);
  return ok({ applied: statements.length });
}
