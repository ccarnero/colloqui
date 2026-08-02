import type { IMongoCollectionSchema } from "./mongo-schema.types";
import { TenantDatabaseTier } from "./tenant-database-tier";

/**
 * Platform MongoDB collections — catalog, auth, registry.
 * Applied on startup by platform services via `MongoModule.register()`.
 */
export const PLATFORM_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  {
    collection: "platform_users",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_platform_users" },
      },
      {
        keys: { email: 1 },
        options: { unique: true, name: "uniq_platform_users_email" },
      },
    ],
  },
  {
    collection: "api_clients",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_api_clients" },
      },
      {
        keys: { client_id: 1 },
        options: { unique: true, name: "uniq_api_clients_client_id" },
      },
      {
        keys: { scope: 1 },
        options: { name: "idx_api_clients_scope" },
      },
    ],
  },
  {
    collection: "public_routes",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_public_routes" },
      },
      {
        keys: { scope: 1, environment: 1 },
        options: { name: "idx_public_routes_scope_env" },
      },
      {
        keys: { environment: 1 },
        options: { name: "idx_public_routes_env" },
      },
    ],
  },
  {
    collection: "tenants",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_tenants" },
      },
      {
        keys: { name: 1 },
        options: { unique: true, name: "uniq_tenants_name" },
      },
      {
        keys: { tier: 1 },
        options: { name: "idx_tenants_tier" },
      },
      {
        keys: { provisioning_status: 1 },
        options: {
          name: "idx_tenants_provisioning_incomplete",
          partialFilterExpression: {
            provisioning_status: {
              $in: ["pending", "provisioning", "failed"],
            },
          },
        },
      },
    ],
  },
  {
    collection: "registered_services",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_registered_services" },
      },
      {
        keys: { tenant_id: 1, name: 1 },
        options: { unique: true, name: "uniq_registered_services_tenant_name" },
      },
      {
        keys: { tenant_id: 1 },
        options: { name: "idx_reg_svc_tenant" },
      },
      {
        keys: { status: 1 },
        options: { name: "idx_reg_svc_status" },
      },
    ],
  },
  {
    collection: "service_routes",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_service_routes" },
      },
      {
        keys: { service_id: 1, path_prefix: 1 },
        options: { unique: true, name: "uniq_service_routes_service_prefix" },
      },
      {
        keys: { service_id: 1 },
        options: { name: "idx_svc_routes_service" },
      },
    ],
  },
  {
    collection: "canary_deployments",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_canary_deployments" },
      },
      {
        keys: { service_id: 1 },
        options: { name: "idx_canary_service" },
      },
    ],
  },
];

/** Default tier value embedded in tenant catalog documents. */
export const PLATFORM_TENANT_DEFAULT_TIER = TenantDatabaseTier.Shared;

/**
 * Tenant catalog documents also carry `messaging_tier`
 * (`TenantTier`, default `free` — `DEFAULT_TENANT_MESSAGING_TIER` in
 * `tenant-stream.constants.ts`) since 2026-08-01. This file declares indexes
 * only (`IMongoCollectionSchema` has no validator support), and the field is
 * not indexed; documents created earlier lack it and read as `free`.
 */
