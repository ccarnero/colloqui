/**
 * Must load before `cache.service` so `cacheServiceConfig` reads CACHE_L1_MAX_SIZE
 * at module initialization (see L1 eviction tests).
 */
process.env.CACHE_L1_MAX_SIZE = "5";
