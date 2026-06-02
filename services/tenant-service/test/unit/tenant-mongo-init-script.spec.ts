import { describe, it, expect } from "bun:test";
import {
  buildMongoSchemaInitScript,
  TENANT_OLTP_MONGO_SCHEMA,
  TENANT_USAGE_MONGO_SCHEMA,
} from "../../src/providers/tenant-mongo-init-script";

describe("tenant mongo init scripts", () => {
  it("composes OLTP schemas from shared descriptors", () => {
    const collections = TENANT_OLTP_MONGO_SCHEMA.map((schema) => schema.collection);
    expect(collections).toContain("workflow_definitions");
    expect(collections).toContain("http_adapters");
    expect(collections).toContain("channel_accounts");
    expect(collections).toContain("tenant_users");
    expect(collections).toContain("events");
  });

  it("includes usage time-series collection", () => {
    expect(TENANT_USAGE_MONGO_SCHEMA[0]?.collection).toBe("channel_events");
    expect(TENANT_USAGE_MONGO_SCHEMA[0]?.timeseries?.timeField).toBe("ts");
  });

  it("buildMongoSchemaInitScript emits idempotent mongosh helpers", () => {
    const script = buildMongoSchemaInitScript("yoizen", TENANT_OLTP_MONGO_SCHEMA);
    expect(script).toContain('db.getSiblingDB("yoizen")');
    expect(script).toContain("ensureCollection");
    expect(script).toContain("ensureIndex");
    expect(script).toContain("workflow_definitions");
  });
});
