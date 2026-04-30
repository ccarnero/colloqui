type AdapterServiceConfig = {
  readonly port: number;
};

export const adapterServiceConfig: AdapterServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
};
