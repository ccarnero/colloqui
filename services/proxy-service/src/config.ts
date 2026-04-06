type ProxyServiceConfig = {
  readonly port: number;
  readonly tenantServiceUrl: string;
};

export const proxyServiceConfig: ProxyServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  tenantServiceUrl:
    process.env.TENANT_SERVICE_URL ??
    "http://tenant-service.platform-services.svc.cluster.local",
};
