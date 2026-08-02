export type { ClientSession, Db, MongoClient } from "mongodb";
export type { ClaimCheckErrorCode, ClaimCheckRef } from "./claim-check";
export {
  ClaimCheckResolveError,
  isClaimCheckEnvelope,
  looksLikeClaimCheck,
  parseClaimCheckRef,
  resolveClaimCheckEnvelope,
  withInflatedData,
} from "./claim-check";
export type { StorageEngine } from "./engine";
export { resolveStorageEngine } from "./engine";
export { selectEngineModule } from "./engine-module.factory";
export {
  checkK8s,
  checkMongo,
  checkNats,
  checkPostgres,
  checkRedis,
  type RedisPinger,
} from "./health-checks";
export {
  K8S_APPS_API,
  K8S_BATCH_API,
  K8S_CORE_API,
  K8S_CUSTOM_OBJECTS_API,
  KubernetesModule,
} from "./kubernetes-provider";
export {
  isFatalMongoError,
  isMongoDuplicateKeyError,
} from "./mongo-errors";
export type {
  MongoModuleOptions,
  MongoPoolOptions,
} from "./mongo-provider";
export {
  buildMongoUri,
  createMongoProvider,
  MONGO_CLIENT,
  MongoModule,
  PLATFORM_MONGO_POOL_OPTIONS,
} from "./mongo-provider";
export { applyMongoSchema } from "./mongo-schema-applier";
export { NatsTenantMongoHealthController } from "./mongo-tenant-health.controller";
export type { IStringIdDoc } from "./mongo-types";
export type { IMultiTenantConsumerConfig } from "./multi-tenant-consumer-manager";
export { MultiTenantConsumerManager } from "./multi-tenant-consumer-manager";
export type {
  INatsConsumerLogger,
  INatsConsumerMetrics,
  INatsConsumerRunnerHandlers,
  INatsConsumerRunnerOptions,
  INatsConsumerRunnerState,
  NatsMessageResult,
  NatsPermanentHandler,
  NatsReattachReason,
} from "./nats-consumer-runner";
export { NatsConsumerRunner } from "./nats-consumer-runner";
export {
  __resetEnsuredDlqStreamCacheForTests,
  ensureTenantDlqStream,
} from "./nats-dlq";
export type { IDurableConsumerOptions } from "./nats-durable-consumer";
export {
  ensureDurableConsumer,
  getDurableConsumer,
} from "./nats-durable-consumer";
export type {
  EnsureConsumerOptions,
  EnsureStreamOptions,
  IEnsureStreamLogger,
  IJetStreamDurableConsumerProviderOptions,
  IJetStreamManagerBootstrapOptions,
  IJetStreamPublisherProviderOptions,
} from "./nats-provider";
export {
  createJetStreamDurableConsumerProvider,
  createJetStreamManagerProvider,
  createJetStreamPublisherProvider,
  createNatsConnectionProvider,
  ensureConsumer,
  ensureStream,
  ensureTenantIngressStream,
  type IEnsureTenantIngressStreamOptions,
  isStreamNotFoundError,
  JetStreamCapacityError,
  NATS_CONNECTION,
  sumReservedStreamBytes,
} from "./nats-provider";
export {
  getNatsRedisHealthStatus,
  type INatsRedisHealthInput,
} from "./nats-redis-health";
export { NatsRedisHealthController } from "./nats-redis-health.controller";
export {
  getNatsTenantMongoHealthStatus,
  type INatsTenantMongoHealthInput,
  type ITenantMongoConnectivity,
} from "./nats-tenant-mongo-health";
export {
  getNatsTenantPostgresHealthStatus,
  type INatsTenantPostgresHealthInput,
  type ITenantPostgresConnectivity,
} from "./nats-tenant-postgres-health";
export { NatsTenantPostgresHealthController } from "./nats-tenant-postgres-health.controller";
export {
  isFatalPoolError,
  isPostgresUniqueViolation,
} from "./postgres-errors";
export type {
  PostgresModuleOptions,
  PostgresPoolOptions,
} from "./postgres-provider";
export {
  createPostgresProvider,
  PLATFORM_POSTGRES_POOL_OPTIONS,
  POSTGRES_SQL,
  PostgresModule,
} from "./postgres-provider";
export type {
  RedisClientOptions,
  RedisLike,
  RedisProviderOptions,
} from "./redis-provider";
export {
  createRedisClient,
  createRedisProvider,
  REDIS_CLIENT,
  redisProvider,
} from "./redis-provider";
export { createRepositoryProvider } from "./repository.provider";
export { requireEnv } from "./require-env";
export type {
  ITenantConnectionManagerOptions,
  ITenantDatabaseTarget,
  SharedTenantDatabaseModeValue,
} from "./tenant-connection-manager";
export {
  SharedTenantDatabaseMode,
  TenantConnectionManager,
} from "./tenant-connection-manager";
export type { ITenantDbConnectionManager } from "./tenant-connection-manager.token";
export { TENANT_DB_CONNECTION_MANAGER } from "./tenant-connection-manager.token";
export { TenantDeletionEvictionListener } from "./tenant-deletion-eviction-listener";
export { TenantGuard, TenantId } from "./tenant-guard";
export type { ITenantMongoConnectionManagerOptions } from "./tenant-mongo-connection-manager";
export { TenantMongoConnectionManager } from "./tenant-mongo-connection-manager";
export { TenantMongoDeletionEvictionListener } from "./tenant-mongo-deletion-eviction-listener";
export { TenantReadySchemaListener } from "./tenant-ready-schema-listener";
export type { Sql } from "./types";
