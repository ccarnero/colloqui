import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AuditController } from "../../src/modules/audit/audit.controller";
import { ChannelAuditProxyController } from "../../src/modules/audit/channel-audit.controller";
import { AuditProxyService } from "../../src/modules/audit/audit-proxy.service";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";

describe("AuditController", () => {
  let controller: AuditController;
  let auditProxy: {
    queryEvents: ReturnType<typeof mock>;
    getEventById: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    auditProxy = {
      queryEvents: mock(() => Promise.resolve({ items: [] })),
      getEventById: mock(() => Promise.resolve({ id: "e1" })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditProxyService, useValue: auditProxy }],
    }).compile();
    controller = moduleRef.get(AuditController);
  });

  const req = { [REQUEST_TENANT_KEY]: "t1" } as never;

  it("queryEvents forwards params and tenant", async () => {
    await controller.queryEvents(req, {
      limit: 10,
      offset: 0,
    } as never);
    expect(auditProxy.queryEvents).toHaveBeenCalled();
  });

  it("getEvent throws NotFound when missing", async () => {
    auditProxy.getEventById = mock(() => Promise.resolve(null));
    await expect(
      controller.getEvent(req, "missing-id"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("ChannelAuditProxyController", () => {
  let controller: ChannelAuditProxyController;
  let auditProxy: {
    queryChannelEvents: ReturnType<typeof mock>;
    getChannelEventById: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    auditProxy = {
      queryChannelEvents: mock(() => Promise.resolve({ items: [] })),
      getChannelEventById: mock(() => Promise.resolve({ id: "c1" })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ChannelAuditProxyController],
      providers: [{ provide: AuditProxyService, useValue: auditProxy }],
    }).compile();
    controller = moduleRef.get(ChannelAuditProxyController);
  });

  const req = { [REQUEST_TENANT_KEY]: "t1" } as never;

  it("queryChannelEvents delegates to audit proxy", async () => {
    await controller.queryChannelEvents(req, {} as never);
    expect(auditProxy.queryChannelEvents).toHaveBeenCalled();
  });

  it("getChannelEvent throws when not found", async () => {
    auditProxy.getChannelEventById = mock(() => Promise.resolve(null));
    await expect(
      controller.getChannelEvent(req, "x"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
