import "../setup-env";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { createMockPostgresSql } from "@yoizen/testing";
import { TokenRepository } from "../../src/modules/token/token.repository";
import { TokenService } from "../../src/modules/token/token.service";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

const JWT_SECRET = "test-secret-at-least-32-characters-long";

describe("TokenService", () => {
  let service: TokenService;
  let sql: ReturnType<typeof createMockPostgresSql>;

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.PLATFORM_ENVIRONMENT = "test";

    sql = createMockPostgresSql(mock);

    const module = await Test.createTestingModule({
      providers: [
        TokenRepository,
        TokenService,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    service = module.get(TokenService);
    service.onModuleInit();
  });

  describe("clientCredentials", () => {
    it("should throw UnauthorizedException for unknown client", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(
        service.clientCredentials("bad-id", "bad-secret"),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("should throw UnauthorizedException for deactivated client", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        {
          id: "c1",
          client_secret_hash: "hash",
          scope: "platform",
          is_active: false,
        },
      ]);
      await expect(
        service.clientCredentials("c1", "secret"),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("should throw UnauthorizedException for wrong secret", async () => {
      const hash = await Bun.password.hash("correct-secret", {
        algorithm: "argon2id",
        memoryCost: 4096,
        timeCost: 1,
      });
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        {
          id: "c1",
          client_secret_hash: hash,
          scope: "platform",
          is_active: true,
        },
      ]);
      await expect(
        service.clientCredentials("c1", "wrong-secret"),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("should return access token for valid credentials", async () => {
      const hash = await Bun.password.hash("correct-secret", {
        algorithm: "argon2id",
        memoryCost: 4096,
        timeCost: 1,
      });
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        {
          id: "c1",
          client_secret_hash: hash,
          scope: "platform",
          is_active: true,
        },
      ]);
      const result = await service.clientCredentials("c1", "correct-secret");
      expect(result.access_token).toBeDefined();
      expect(result.token_type).toBe("Bearer");
      expect(result.scope).toBe("platform");
      expect(result.refresh_token).toBeUndefined();
    });
  });

  describe("login", () => {
    it("should throw for unknown email", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(
        service.login("unknown@test.com", "password"),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("should return tokens for valid platform user", async () => {
      const hash = await Bun.password.hash("password123", {
        algorithm: "argon2id",
        memoryCost: 4096,
        timeCost: 1,
      });
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        {
          id: "u1",
          email: "admin@test.com",
          password_hash: hash,
          role: "admin",
          is_active: true,
        },
      ]);

      const result = await service.login("admin@test.com", "password123");
      expect(result.access_token).toBeDefined();
      expect(result.refresh_token).toBeDefined();
      expect(result.scope).toBe("platform");
    });

    it("should throw for deactivated platform user", async () => {
      const hash = await Bun.password.hash("password123", {
        algorithm: "argon2id",
        memoryCost: 4096,
        timeCost: 1,
      });
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        {
          id: "u1",
          email: "admin@test.com",
          password_hash: hash,
          role: "admin",
          is_active: false,
        },
      ]);

      await expect(
        service.login("admin@test.com", "password123"),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("refresh", () => {
    it("should throw UnauthorizedException for invalid token", async () => {
      await expect(service.refresh("invalid-token")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

});
