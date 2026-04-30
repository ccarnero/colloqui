/** Minimal env for unit tests that load tenant-service config / providers. */
if (!process.env.POSTGRES_PASSWORD) {
  process.env.POSTGRES_PASSWORD = "test-postgres-password";
}
