const ARGON2_OPTIONS = {
  algorithm: "argon2id" as const,
  memoryCost: 19_456,
  timeCost: 2,
};

/**
 * Argon2id hash for passwords and client secrets (single entry point).
 */
export function hashSecret(plain: string): Promise<string> {
  return Bun.password.hash(plain, ARGON2_OPTIONS);
}
