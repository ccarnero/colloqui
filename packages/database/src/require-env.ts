/**
 * Returns the value of an environment variable, throwing if it is not set.
 * Use for required configuration that must not have a hardcoded default.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}
