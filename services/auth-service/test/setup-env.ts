/** Ensure JWT_SECRET exists before auth/config modules load. */
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
}
if (!process.env.PLATFORM_ENVIRONMENT) {
  process.env.PLATFORM_ENVIRONMENT = "test";
}
