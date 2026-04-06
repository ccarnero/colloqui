import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AuthController } from "../../src/modules/auth/auth.controller";
import { AuthFacadeService } from "../../src/modules/auth/auth-facade.service";

describe("AuthController", () => {
  let controller: AuthController;
  let tokenMock: ReturnType<typeof mock>;
  let loginMock: ReturnType<typeof mock>;

  beforeEach(async () => {
    tokenMock = mock(() => Promise.resolve({ access_token: "a" }));
    loginMock = mock(() => Promise.resolve({ ok: true }));

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthFacadeService,
          useValue: {
            token: tokenMock,
            login: loginMock,
            refreshToken: mock(() => Promise.resolve({})),
            listPublicRoutes: mock(() => Promise.resolve({})),
            createPublicRoute: mock(() => Promise.resolve({})),
            removePublicRoute: mock(() => Promise.resolve({})),
            listUsers: mock(() => Promise.resolve({})),
            createUser: mock(() => Promise.resolve({})),
            listClients: mock(() => Promise.resolve({})),
            createClient: mock(() => Promise.resolve({})),
            revokeClient: mock(() => Promise.resolve({})),
            listTenantUsers: mock(() => Promise.resolve({})),
            createTenantUser: mock(() => Promise.resolve({})),
            updateTenantUser: mock(() => Promise.resolve({})),
            removeTenantUser: mock(() => Promise.resolve({})),
            listTenantRoles: mock(() => Promise.resolve({})),
            createTenantRole: mock(() => Promise.resolve({})),
            updateTenantRole: mock(() => Promise.resolve({})),
            deleteTenantRole: mock(() => Promise.resolve({})),
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(AuthController);
  });

  it("token delegates to AuthFacadeService.token", async () => {
    const body = {
      grant_type: "client_credentials" as const,
      client_id: "c",
      client_secret: "s",
    };
    await controller.token(body);
    expect(tokenMock).toHaveBeenCalledWith(body);
  });

  it("login delegates to AuthFacadeService.login", async () => {
    const body = { email: "a@b.com", password: "p" };
    await controller.login(body);
    expect(loginMock).toHaveBeenCalledWith(body);
  });
});
