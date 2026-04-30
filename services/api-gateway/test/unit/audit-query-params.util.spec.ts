import { describe, it, expect } from "bun:test";
import {
  auditEventsToParams,
  channelEventsToParams,
} from "../../src/modules/audit/audit-query-params.util";
import type {
  QueryAuditEventsProxyDto,
  QueryChannelEventsProxyDto,
} from "../../src/modules/audit/audit-proxy-query.dto";

describe("auditEventsToParams", () => {
  it("maps DTO fields to string query record", () => {
    const q: QueryAuditEventsProxyDto = {
      type: "evt",
      from: "2024-01-01",
      to: "2024-01-02",
      limit: 50,
      offset: 10,
    };
    expect(auditEventsToParams(q)).toEqual({
      type: "evt",
      from: "2024-01-01",
      to: "2024-01-02",
      limit: "50",
      offset: "10",
    });
  });

  it("omits undefined optional fields as undefined values", () => {
    const q: QueryAuditEventsProxyDto = { limit: 1 };
    const out = auditEventsToParams(q);
    expect(out.type).toBeUndefined();
    expect(out.from).toBeUndefined();
    expect(out.to).toBeUndefined();
    expect(out.limit).toBe("1");
    expect(out.offset).toBeUndefined();
  });
});

describe("channelEventsToParams", () => {
  it("maps channel query DTO to string query record", () => {
    const q: QueryChannelEventsProxyDto = {
      channel: "wa",
      kind: "msg",
      accountId: "acc1",
      from: "a",
      to: "b",
      limit: 20,
      offset: 0,
    };
    expect(channelEventsToParams(q)).toEqual({
      channel: "wa",
      kind: "msg",
      accountId: "acc1",
      from: "a",
      to: "b",
      limit: "20",
      offset: "0",
    });
  });
});
