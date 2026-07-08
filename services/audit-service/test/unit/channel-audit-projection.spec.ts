import { describe, expect, it } from "bun:test";
import {
  CHANNEL_AUDIT_SELECT_PROJECTION,
  type IStoredChannelEvent,
  mapChannelAuditDoc,
} from "../../src/common/channel-audit-projection";

describe("channel-audit-projection", () => {
  describe("CHANNEL_AUDIT_SELECT_PROJECTION", () => {
    it("includes correlation_id, causation_id, and depth columns", () => {
      expect(CHANNEL_AUDIT_SELECT_PROJECTION).toContain(
        'correlation_id   AS "correlationId"'
      );
      expect(CHANNEL_AUDIT_SELECT_PROJECTION).toContain(
        'causation_id     AS "causationId"'
      );
      expect(CHANNEL_AUDIT_SELECT_PROJECTION).toContain("depth");
    });
  });

  describe("mapChannelAuditDoc", () => {
    it("maps populated correlation_id, causation_id, and depth", () => {
      const doc = {
        _id: "evt-1",
        tenant_id: "t1",
        channel: "whatsapp",
        provider: "meta",
        kind: "message_received",
        account_id: "acc-1",
        from_id: "+5491112345678",
        to_id: null,
        message_type: "text",
        message_text: "hello",
        provider_message_id: "mid-123",
        correlation_id: "corr-abc",
        causation_id: "caus-xyz",
        depth: 2,
        data: { payload: {} },
        nats_subject: "evt.t1.channel-service.messaging.whatsapp.message.v1",
        created_at: new Date("2026-06-20T00:00:00Z"),
      };

      const result: IStoredChannelEvent = mapChannelAuditDoc(doc);

      expect(result.correlationId).toBe("corr-abc");
      expect(result.causationId).toBe("caus-xyz");
      expect(result.depth).toBe(2);
    });

    it("maps conversation_id when present", () => {
      const doc = {
        _id: "evt-conv-1",
        tenant_id: "t1",
        channel: "whatsapp",
        provider: "meta",
        kind: "message_received",
        account_id: "acc-1",
        from_id: "+5491112345678",
        to_id: null,
        message_type: "text",
        message_text: "hello",
        provider_message_id: "mid-123",
        conversation_id: "conv-abc",
        data: { payload: { conversationId: "conv-abc" } },
        nats_subject: "evt.t1.channel-service.messaging.whatsapp.message.v1",
        created_at: new Date("2026-07-07T00:00:00Z"),
      };

      const result = mapChannelAuditDoc(doc);
      expect(result.conversationId).toBe("conv-abc");
    });

    it("maps conversation_id to null when absent", () => {
      const doc = {
        _id: "evt-conv-2",
        tenant_id: "t1",
        channel: "whatsapp",
        provider: "meta",
        kind: "message_received",
        account_id: "acc-1",
        data: {},
        nats_subject: "evt.t1",
        created_at: new Date("2026-07-07T00:00:00Z"),
      };

      const result = mapChannelAuditDoc(doc);
      expect(result.conversationId).toBeNull();
    });

    it("maps null correlation/causation when absent in doc", () => {
      const doc = {
        _id: "evt-2",
        tenant_id: "t1",
        channel: "whatsapp",
        provider: "meta",
        kind: "message_received",
        account_id: "acc-1",
        from_id: null,
        to_id: null,
        message_type: null,
        message_text: null,
        provider_message_id: null,
        data: {},
        nats_subject: "evt.t1",
        created_at: new Date("2026-06-20T00:00:00Z"),
      };

      const result = mapChannelAuditDoc(doc);

      expect(result.correlationId).toBeNull();
      expect(result.causationId).toBeNull();
      expect(result.depth).toBeNull();
    });

    it("maps depth to null when doc.depth is not a number", () => {
      const doc = {
        _id: "evt-3",
        tenant_id: "t1",
        channel: "telegram",
        provider: "telegram",
        kind: "message_received",
        account_id: "acc-2",
        from_id: null,
        to_id: null,
        message_type: null,
        message_text: null,
        provider_message_id: null,
        correlation_id: "corr-1",
        causation_id: null,
        depth: "not-a-number", // malformed — must map to null
        data: {},
        nats_subject: "evt.t1",
        created_at: new Date("2026-06-20T00:00:00Z"),
      };

      const result = mapChannelAuditDoc(doc);

      expect(result.correlationId).toBe("corr-1");
      expect(result.causationId).toBeNull();
      expect(result.depth).toBeNull();
    });
  });
});
