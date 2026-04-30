import { describe, it, expect, afterEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ConflictException } from "@nestjs/common";
import { UsersRepository } from "../../src/modules/users/users.repository";
import { UsersService } from "../../src/modules/users/users.service";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import type { Sql } from "../../src/providers/postgres.provider";

describe("UsersService", () => {
  let service: UsersService;

  afterEach(() => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
  });

  it("onModuleInit skips admin seed when ADMIN_EMAIL is unset", async () => {
    const mockSql = Object.assign(
      () => Promise.resolve([]),
      {},
    ) as unknown as Sql;

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersRepository,
        UsersService,
        { provide: POSTGRES_SQL, useValue: mockSql },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it("onModuleInit skips create when an admin already exists", async () => {
    let insertCalls = 0;
    const mockSql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const q = strings.reduce(
          (acc, s, i) => acc + s + String(values[i] ?? ""),
          "",
        );
        if (q.includes("WHERE role = ") && q.includes("admin")) {
          return Promise.resolve([{ id: "admin-1" }]);
        }
        if (q.includes("INSERT INTO platform_users")) {
          insertCalls += 1;
        }
        return Promise.resolve([]);
      },
      {},
    ) as unknown as Sql;

    process.env.ADMIN_EMAIL = "admin@example.com";
    process.env.ADMIN_PASSWORD = "secret";

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersRepository,
        UsersService,
        { provide: POSTGRES_SQL, useValue: mockSql },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
    await service.onModuleInit();
    expect(insertCalls).toBe(0);
  });

  it("list delegates to repository.listActive", async () => {
    const mockRepo = {
      findByEmail: mock(() => Promise.resolve([])),
      findAdmin: mock(() => Promise.resolve([])),
      listActive: mock(() =>
        Promise.resolve([
          {
            id: "u1",
            email: "a@b.com",
            password_hash: "h",
            role: "platform",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]),
      ),
      insertUser: mock(() => Promise.resolve([])),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: UsersRepository, useValue: mockRepo },
        UsersService,
      ],
    }).compile();
    const svc = moduleRef.get(UsersService);
    const rows = await svc.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("a@b.com");
  });

  it("create throws ConflictException when email exists", async () => {
    const mockRepo = {
      findByEmail: mock(() => Promise.resolve([{ id: "x" }])),
      findAdmin: mock(() => Promise.resolve([])),
      listActive: mock(() => Promise.resolve([])),
      insertUser: mock(() => Promise.resolve([])),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: UsersRepository, useValue: mockRepo },
        UsersService,
      ],
    }).compile();
    const svc = moduleRef.get(UsersService);
    await expect(svc.create("a@b.com", "pw", "admin")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("create inserts when email is new", async () => {
    const row = {
      id: "new-id",
      email: "new@b.com",
      password_hash: "hash",
      role: "editor",
      created_at: new Date(),
      updated_at: new Date(),
    };
    const mockRepo = {
      findByEmail: mock(() => Promise.resolve([])),
      findAdmin: mock(() => Promise.resolve([])),
      listActive: mock(() => Promise.resolve([])),
      insertUser: mock(() => Promise.resolve([row])),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: UsersRepository, useValue: mockRepo },
        UsersService,
      ],
    }).compile();
    const svc = moduleRef.get(UsersService);
    const created = await svc.create("new@b.com", "secret", "editor");
    expect(created.email).toBe("new@b.com");
    expect(created.role).toBe("editor");
  });
});
