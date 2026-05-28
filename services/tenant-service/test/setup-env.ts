/** Minimal env for unit tests that load tenant-service config / providers. */
process.env.DB_ENGINE = "mongo";
if (!process.env.MONGO_PASSWORD) {
  process.env.MONGO_PASSWORD = "test-mongo-password";
}
if (!process.env.POSTGRES_PASSWORD) {
  process.env.POSTGRES_PASSWORD = "test-postgres-password";
}
