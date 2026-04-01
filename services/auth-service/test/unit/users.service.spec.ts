import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ConflictException } from "@nestjs/common";
import { UsersService } from "../../src/modules/users/users.service";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

function createMockSql() {
  const fn = mock((..._args: unknown[]) => Promise.resolve([]));
  return fn as unknown as ReturnType<typeof import("postgres")>;
}

describe("UsersService", () => {
  let service: UsersService;
  let sql: ReturnType<typeof createMockSql>;

  beforeEach(async () => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;

    sql = createMockSql();

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe("create", () => {
    it("should throw ConflictException if email already exists", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "existing-id" },
      ]);
      await expect(
        service.create("dup@test.com", "password123", "admin"),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("should create user and return without is_active", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      const created = {
        id: "new-id",
        email: "new@test.com",
        role: "operator",
        created_at: new Date(),
        updated_at: new Date(),
      };
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([created]);

      const result = await service.create("new@test.com", "password123", "operator");
      expect(result.email).toBe("new@test.com");
      expect(result.role).toBe("operator");
    });
  });

  describe("list", () => {
    it("should return list of active users", async () => {
      const users = [
        { id: "u1", email: "a@test.com", role: "admin", created_at: new Date(), updated_at: new Date() },
      ];
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce(users);
      const result = await service.list();
      expect(result).toHaveLength(1);
      expect(result[0].email).toBe("a@test.com");
    });
  });
});
