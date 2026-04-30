import { describe, expect, it } from "bun:test";
import type { NatsConnection } from "nats";
import { buildTenantWildcard } from "@yoizen/shared";
import type { MessageKind } from "@yoizen/shared";
import { ChannelStreamService } from "../../src/modules/channels/channel-stream.service";

describe("ChannelStreamService", () => {
  it("subscribes to tenant wildcard when no kinds", () => {
    const subjects: string[] = [];
    const mockNc = {
      subscribe: (subject: string) => {
        subjects.push(subject);
        return {
          async *[Symbol.asyncIterator]() {
            // no messages
          },
          unsubscribe: () => {},
        };
      },
    } as unknown as NatsConnection;

    const svc = new ChannelStreamService(mockNc);
    const sub = svc.streamChannelEvents("tenant-z", []).subscribe();
    sub.unsubscribe();

    expect(subjects).toEqual([buildTenantWildcard("tenant-z")]);
  });

  it("subscribes to kind-specific subjects when kinds provided", () => {
    const subjects: string[] = [];
    const mockNc = {
      subscribe: (subject: string) => {
        subjects.push(subject);
        return {
          async *[Symbol.asyncIterator]() {},
          unsubscribe: () => {},
        };
      },
    } as unknown as NatsConnection;

    const kinds: MessageKind[] = ["received"];
    const svc = new ChannelStreamService(mockNc);
    const sub = svc.streamChannelEvents("tenant-z", kinds).subscribe();
    sub.unsubscribe();

    expect(subjects.length).toBe(1);
    expect(subjects[0]).toContain("tenant-z");
    expect(subjects[0]).toContain("received");
  });
});
