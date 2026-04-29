import "../setup-env";
import { describe, expect, it, mock } from "bun:test";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { FastifyReply } from "fastify";
import { TenantsController } from "../../src/modules/tenants/tenants.controller";
import { TenantsService } from "../../src/modules/tenants/tenants.service";

interface IFakeReply {
  readonly reply: FastifyReply;
  readonly headers: Map<string, string>;
  readonly statusCode: { value: number | null };
}

/**
 * Tiny FastifyReply stand-in. We only need the `code()` and `header()`
 * methods used by `TenantsController.remove`. Using a Map for headers
 * gives O(1) lookups during assertions and matches the user-rule of
 * preferring Map for keyed collections.
 */
function buildFakeReply(): IFakeReply {
  const headers = new Map<string, string>();
  const statusCode: { value: number | null } = { value: null };
  const reply = {
    code: (n: number) => {
      statusCode.value = n;
      return reply;
    },
    header: (key: string, value: string) => {
      headers.set(key.toLowerCase(), value);
      return reply;
    },
  } as unknown as FastifyReply;
  return { reply, headers, statusCode };
}

describe("TenantsController", () => {
  it("delegates create/list/getOne/update/remove to service", async () => {
    const serviceMock = {
      createTenant: mock(() => Promise.resolve({ name: "tenant-a" })),
      listTenants: mock(() => Promise.resolve([{ name: "tenant-a" }])),
      getTenant: mock(() => Promise.resolve({ name: "tenant-a" })),
      getTenantById: mock(() => Promise.resolve({ id: "u1" })),
      updateTenant: mock(() => Promise.resolve({ name: "tenant-a" })),
      deleteTenant: mock(() => Promise.resolve()),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [{ provide: TenantsService, useValue: serviceMock }],
    }).compile();

    const controller = moduleRef.get(TenantsController);
    const fakeReply = buildFakeReply();
    await controller.create({ name: "tenant-a", configuration: {} });
    await controller.list();
    await controller.getOne("tenant-a");
    await controller.getOne("550e8400-e29b-41d4-a716-446655440000");
    await controller.update("tenant-a", { configuration: {} });
    await controller.remove("tenant-a", fakeReply.reply);

    expect(serviceMock.createTenant).toHaveBeenCalledTimes(1);
    expect(serviceMock.listTenants).toHaveBeenCalledTimes(1);
    expect(serviceMock.getTenant).toHaveBeenCalledWith("tenant-a");
    expect(serviceMock.getTenantById).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(serviceMock.updateTenant).toHaveBeenCalledTimes(1);
    expect(serviceMock.deleteTenant).toHaveBeenCalledTimes(1);
    // Successful delete sets 204 and does NOT advertise Retry-After.
    expect(fakeReply.statusCode.value).toBe(HttpStatus.NO_CONTENT);
    expect(fakeReply.headers.has("retry-after")).toBe(false);
  });

  it("decorates 409 Conflict from the service with a Retry-After header", async () => {
    const conflict = new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        error: "Conflict",
        message: "Tenant 'tenant-a' is currently provisioning",
        provisioningStatus: "provisioning",
      },
      HttpStatus.CONFLICT,
    );
    const serviceMock = {
      createTenant: mock(() => Promise.reject(new Error("not used"))),
      listTenants: mock(() => Promise.reject(new Error("not used"))),
      getTenant: mock(() => Promise.reject(new Error("not used"))),
      getTenantById: mock(() => Promise.reject(new Error("not used"))),
      updateTenant: mock(() => Promise.reject(new Error("not used"))),
      deleteTenant: mock(() => Promise.reject(conflict)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [{ provide: TenantsService, useValue: serviceMock }],
    }).compile();

    const controller = moduleRef.get(TenantsController);
    const fakeReply = buildFakeReply();

    let thrown: HttpException | null = null;
    try {
      await controller.remove("tenant-a", fakeReply.reply);
    } catch (err) {
      thrown = err as HttpException;
    }
    expect(thrown).toBe(conflict);
    expect(fakeReply.headers.get("retry-after")).toBe("10");
    // 204 must NOT have been set when we're propagating a 409
    expect(fakeReply.statusCode.value).toBeNull();
  });

  it("forwards a valid ?status= query as a filter to the service", async () => {
    const serviceMock = {
      createTenant: mock(() => Promise.reject(new Error("not used"))),
      listTenants: mock(() => Promise.resolve([])),
      getTenant: mock(() => Promise.reject(new Error("not used"))),
      getTenantById: mock(() => Promise.reject(new Error("not used"))),
      updateTenant: mock(() => Promise.reject(new Error("not used"))),
      deleteTenant: mock(() => Promise.reject(new Error("not used"))),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [{ provide: TenantsService, useValue: serviceMock }],
    }).compile();

    const controller = moduleRef.get(TenantsController);
    await controller.list("ready");
    expect(serviceMock.listTenants).toHaveBeenCalledWith({ status: "ready" });
  });

  it("treats an empty ?status= as 'no filter' (compat with `?status=`)", async () => {
    const serviceMock = {
      createTenant: mock(() => Promise.reject(new Error("not used"))),
      listTenants: mock(() => Promise.resolve([])),
      getTenant: mock(() => Promise.reject(new Error("not used"))),
      getTenantById: mock(() => Promise.reject(new Error("not used"))),
      updateTenant: mock(() => Promise.reject(new Error("not used"))),
      deleteTenant: mock(() => Promise.reject(new Error("not used"))),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [{ provide: TenantsService, useValue: serviceMock }],
    }).compile();

    const controller = moduleRef.get(TenantsController);
    await controller.list("");
    expect(serviceMock.listTenants).toHaveBeenCalledWith(undefined);
  });

  it("rejects an unknown ?status= with BadRequestException (no service call)", async () => {
    const serviceMock = {
      createTenant: mock(() => Promise.reject(new Error("not used"))),
      listTenants: mock(() => Promise.reject(new Error("not used"))),
      getTenant: mock(() => Promise.reject(new Error("not used"))),
      getTenantById: mock(() => Promise.reject(new Error("not used"))),
      updateTenant: mock(() => Promise.reject(new Error("not used"))),
      deleteTenant: mock(() => Promise.reject(new Error("not used"))),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [{ provide: TenantsService, useValue: serviceMock }],
    }).compile();

    const controller = moduleRef.get(TenantsController);
    await expect(controller.list("garbage")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(serviceMock.listTenants).not.toHaveBeenCalled();
  });

  it("does not advertise Retry-After for non-409 errors", async () => {
    const internal = new HttpException(
      "boom",
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    const serviceMock = {
      createTenant: mock(() => Promise.reject(new Error("not used"))),
      listTenants: mock(() => Promise.reject(new Error("not used"))),
      getTenant: mock(() => Promise.reject(new Error("not used"))),
      getTenantById: mock(() => Promise.reject(new Error("not used"))),
      updateTenant: mock(() => Promise.reject(new Error("not used"))),
      deleteTenant: mock(() => Promise.reject(internal)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [{ provide: TenantsService, useValue: serviceMock }],
    }).compile();

    const controller = moduleRef.get(TenantsController);
    const fakeReply = buildFakeReply();

    await expect(
      controller.remove("tenant-a", fakeReply.reply),
    ).rejects.toBeInstanceOf(HttpException);
    expect(fakeReply.headers.has("retry-after")).toBe(false);
  });
});
