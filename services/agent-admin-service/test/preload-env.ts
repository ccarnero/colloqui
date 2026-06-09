/** Ensures required env vars exist before modules load config (unit tests). */
process.env.MONGO_PASSWORD ??= process.env.POSTGRES_PASSWORD ?? "test-unit-secret";
process.env.POSTGRES_PASSWORD ??= "test-unit-secret";
process.env.STORAGE_ENGINE ??= "mongo";
