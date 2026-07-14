type ProvisioningServiceConfig = {
  readonly port: number;
};

export const provisioningServiceConfig: ProvisioningServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
};
