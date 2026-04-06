/** Platform deployment environments (namespace / label scoping). */
export const VALID_ENVIRONMENTS = [
  "dev",
  "qa",
  "staging",
  "production",
] as const;

export type Environment = (typeof VALID_ENVIRONMENTS)[number];
