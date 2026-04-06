type MetricsServiceConfig = {
  readonly port: number;
};

export const metricsServiceConfig: MetricsServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
};
