import { describe, it, expect, mock, beforeEach } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { UsageService } from "../../src/modules/usage/usage.service";
import type { UsageRepository } from "../../src/modules/usage/usage.repository";

function makeRepo() {
  const getBuckets = mock(() => Promise.resolve([]));
  const getTotals = mock(() => Promise.resolve([]));
  return {
    repository: { getBuckets, getTotals } as unknown as UsageRepository,
    getBuckets,
    getTotals,
  };
}

describe("UsageService", () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: UsageService;

  beforeEach(() => {
    repo = makeRepo();
    service = new UsageService(repo.repository);
  });

  it("delegates getUsage with default hour bucket", async () => {
    await service.getUsage("tenant-1", {
      from: "2026-04-20T00:00:00Z",
      to: "2026-04-23T00:00:00Z",
    });
    expect(repo.getBuckets).toHaveBeenCalledTimes(1);
    const args = repo.getBuckets.mock.calls[0]![0]!;
    expect(args.tenantId).toBe("tenant-1");
    expect(args.bucket).toBe("hour");
    expect(args.from).toBeInstanceOf(Date);
    expect(args.to).toBeInstanceOf(Date);
  });

  it("passes through optional filters when supplied", async () => {
    await service.getUsage("tenant-1", {
      from: "2026-04-20T00:00:00Z",
      to: "2026-04-23T00:00:00Z",
      bucket: "day",
      accountId: "acct-1",
      channel: "telegram",
      direction: "ingress",
    });
    const args = repo.getBuckets.mock.calls[0]![0]!;
    expect(args.bucket).toBe("day");
    expect(args.accountId).toBe("acct-1");
    expect(args.channel).toBe("telegram");
    expect(args.direction).toBe("ingress");
  });

  it("throws on non-ISO ranges", async () => {
    let thrown: unknown = null;
    try {
      await service.getUsage("tenant-1", { from: "nope", to: "2026-04-23T00:00:00Z" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
  });

  it("throws when from >= to", async () => {
    let thrown: unknown = null;
    try {
      await service.getUsage("tenant-1", {
        from: "2026-04-23T00:00:00Z",
        to: "2026-04-20T00:00:00Z",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
  });

  it("rejects ranges wider than 90 days", async () => {
    let thrown: unknown = null;
    try {
      await service.getUsage("tenant-1", {
        from: "2026-01-01T00:00:00Z",
        to: "2026-05-01T00:00:00Z",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
  });

  it("delegates totals with optional filters", async () => {
    await service.getUsageTotals("tenant-2", {
      from: "2026-04-20T00:00:00Z",
      to: "2026-04-23T00:00:00Z",
      accountId: "acct-9",
    });
    expect(repo.getTotals).toHaveBeenCalledTimes(1);
    const args = repo.getTotals.mock.calls[0]![0]!;
    expect(args.tenantId).toBe("tenant-2");
    expect(args.accountId).toBe("acct-9");
  });
});
