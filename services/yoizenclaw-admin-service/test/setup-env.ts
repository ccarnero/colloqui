/** Ensures config loaders succeed before importing application modules in tests. */
process.env.MONGO_PASSWORD ??= process.env.POSTGRES_PASSWORD ?? "test";
process.env.POSTGRES_PASSWORD ??= "test";
process.env.STORAGE_ENGINE ??= "mongo";
