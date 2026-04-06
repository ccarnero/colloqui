import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { TokenController } from "../../src/modules/token/token.controller";
import { GrantType } from "../../src/modules/token/token.dto";
import { TokenService } from "../../src/modules/token/token.service";
import type { TokenResponse } from "@yoizen/shared";

describe("TokenController", () => {
  let controller: TokenController;
  let tokenService: {
    clientCredentials: ReturnType<typeof mock>;
    login: ReturnType<typeof mock>;
    refresh: ReturnType<typeof mock>;
  };

  const sampleToken: TokenResponse = {
    access_token: "access.jwt",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "platform",
    refresh_token: "refresh.jwt",
  };

  beforeEach(async () => {
    tokenService = {
      clientCredentials: mock(() => Promise.resolve(sampleToken)),
      login: mock(() => Promise.resolve(sampleToken)),
      refresh: mock(() => Promise.resolve(sampleToken)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TokenController],
      providers: [{ provide: TokenService, useValue: tokenService }],
    }).compile();

    controller = moduleRef.get(TokenController);
  });

  describe("token", () => {
    it("delegates to TokenService.clientCredentials and returns TokenResponse", async () => {
      const result = await controller.token({
        grant_type: GrantType.CLIENT_CREDENTIALS,
        client_id: "yoizen_abc",
        client_secret: "ysk_secret",
      });
      expect(tokenService.clientCredentials).toHaveBeenCalledTimes(1);
      expect(tokenService.clientCredentials).toHaveBeenCalledWith(
        "yoizen_abc",
        "ysk_secret",
      );
      expect(result).toEqual(sampleToken);
    });
  });

  describe("login", () => {
    it("delegates to TokenService.login with email, password, tenant_id", async () => {
      const result = await controller.login({
        email: "user@example.com",
        password: "secret",
        tenant_id: "tenant-a",
      });
      expect(tokenService.login).toHaveBeenCalledTimes(1);
      expect(tokenService.login).toHaveBeenCalledWith(
        "user@example.com",
        "secret",
        "tenant-a",
      );
      expect(result).toEqual(sampleToken);
    });

    it("passes undefined tenant_id when omitted", async () => {
      await controller.login({
        email: "user@example.com",
        password: "secret",
      });
      expect(tokenService.login).toHaveBeenCalledWith(
        "user@example.com",
        "secret",
        undefined,
      );
    });
  });

  describe("refresh", () => {
    it("delegates to TokenService.refresh with refresh_token", async () => {
      const result = await controller.refresh({
        refresh_token: "rt-1",
      });
      expect(tokenService.refresh).toHaveBeenCalledTimes(1);
      expect(tokenService.refresh).toHaveBeenCalledWith("rt-1");
      expect(result).toEqual(sampleToken);
    });
  });
});
