import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AuthFacadeService } from "../../src/modules/auth/auth-facade.service";
import { AuthProxyService } from "../../src/modules/auth/auth-proxy.service";
import { TenantProxyService } from "../../src/modules/tenants/tenant-proxy.service";
import type { AuthTokenBodyDto } from "../../src/modules/auth/auth.dto";

describe("AuthFacadeService", () => {
  let facade: AuthFacadeService;
  let authProxy: { proxy: ReturnType<typeof mock> };
  let tenantProxy: { getTenant: ReturnType<typeof mock> };

  const tokenBody: AuthTokenBodyDto = {
    grant_type: "client_credentials",
    client_id: "c",
    client_secret: "s",
  };

  beforeEach(async () => {
    authProxy = {
      proxy: mock(() =>
        Promise.resolve({ access_token: "x", scope: "platform" }),
      ),
    };
    tenantProxy = {
      getTenant: mock(() => Promise.resolve({ name: "t1" })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: AuthFacadeService,
          useFactory: () =>
            new AuthFacadeService(
              authProxy as unknown as AuthProxyService,
              tenantProxy as unknown as TenantProxyService,
            ),
        },
      ],
    }).compile();

    facade = moduleRef.get(AuthFacadeService);
  });

  it("token returns auth result when scope is platform", async () => {
    const out = await facade.token(tokenBody);
    expect(out).toEqual(
      expect.objectContaining({ access_token: "x", scope: "platform" }),
    );
    expect(tenantProxy.getTenant).not.toHaveBeenCalled();
  });

  it("token resolves tenant when scope is tenant-scoped", async () => {
    authProxy.proxy.mockResolvedValueOnce({
      access_token: "x",
      scope: "tenant:acme",
    });
    await facade.token(tokenBody);
    expect(tenantProxy.getTenant).toHaveBeenCalledWith("acme");
  });
});
