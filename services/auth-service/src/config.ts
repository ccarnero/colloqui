type AuthServiceConfig = {
  readonly port: number;
  readonly platformEnvironment: string;
  readonly jwtSecret: string | undefined;
  readonly adminEmail: string | undefined;
  readonly adminPassword: string | undefined;
  readonly tenantAdminTenantId: string | undefined;
  readonly tenantAdminEmail: string | undefined;
  readonly tenantAdminPassword: string | undefined;
  readonly tenantAdminDisplayName: string | undefined;
};

/** Lazy getters so tests can set `process.env` before first consumer reads secrets. */
export const authServiceConfig: AuthServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get platformEnvironment() {
    return process.env.PLATFORM_ENVIRONMENT ?? "dev";
  },
  get jwtSecret() {
    return process.env.JWT_SECRET;
  },
  get adminEmail() {
    return process.env.ADMIN_EMAIL;
  },
  get adminPassword() {
    return process.env.ADMIN_PASSWORD;
  },
  get tenantAdminTenantId() {
    return process.env.TENANT_ADMIN_TENANT_ID;
  },
  get tenantAdminEmail() {
    return process.env.TENANT_ADMIN_EMAIL;
  },
  get tenantAdminPassword() {
    return process.env.TENANT_ADMIN_PASSWORD;
  },
  get tenantAdminDisplayName() {
    return process.env.TENANT_ADMIN_DISPLAY_NAME;
  },
};
