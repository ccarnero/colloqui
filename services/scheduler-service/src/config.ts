type SchedulerServiceConfig = {
  readonly port: number;
  readonly tenantServiceUrl: string;
  readonly platformEnvironment: string;
};

export const schedulerServiceConfig: SchedulerServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  tenantServiceUrl: process.env.TENANT_SERVICE_URL ?? "",
  platformEnvironment: process.env.PLATFORM_ENVIRONMENT ?? "dev",
};
