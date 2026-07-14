/**
 * Reads a required environment variable, or throws with a clear message
 * naming the missing var. Adapted from
 * `sdk/samples/http-bridge/src/setup.ts` — copied, not imported, per
 * `demos/README.md`'s no-cross-tree-imports rule.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}
