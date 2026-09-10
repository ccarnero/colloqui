// Where the journeys run. Everything comes from the environment with the dev-cluster defaults from
// DOCS/guides/onboarding.md; nothing here is a secret worth more than the demo tenant.
export const env = {
  consoleUrl: process.env.E2E_BASE_URL ?? "http://admin-console.platform-services-dev.dev.local",
  apiUrl: process.env.E2E_API_URL ?? "http://api-gateway.platform-services-dev.dev.local",
  tenant: process.env.E2E_TENANT ?? "acme",
  email: process.env.E2E_EMAIL ?? "yclawd@demo.io",
  password: process.env.E2E_PASSWORD ?? "admin123",
  // A tenant that must never see our records. J1 uses it to prove isolation.
  foreignTenant: process.env.E2E_FOREIGN_TENANT ?? "not-acme",
} as const;

export const TENANT_HEADER = "x-yoizen-tenant";
