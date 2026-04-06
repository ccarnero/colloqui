/** Ensures config loaders succeed before importing application modules in tests. */
process.env.POSTGRES_PASSWORD ??= "test";
