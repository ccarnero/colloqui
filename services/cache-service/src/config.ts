type CacheServiceConfig = {
  readonly port: number;
  readonly cacheL1MaxSize: number;
};

export const cacheServiceConfig: CacheServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  cacheL1MaxSize: Number.parseInt(process.env.CACHE_L1_MAX_SIZE ?? "1000", 10),
};
