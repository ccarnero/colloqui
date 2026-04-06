/** Ensures required env vars exist before modules load config (unit tests). */
process.env.POSTGRES_PASSWORD ??= "test-unit-secret";
