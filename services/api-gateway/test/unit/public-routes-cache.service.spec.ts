import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { PublicRoutesCacheService } from "../../src/modules/auth/public-routes-cache.service";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";

describe("PublicRoutesCacheService", () => {
  let svc: PublicRoutesCacheService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicRoutesCacheService,
        { provide: REDIS_CLIENT, useValue: { get: mock(() => Promise.resolve(null)) } },
      ],
    }).compile();
    svc = moduleRef.get(PublicRoutesCacheService);
  });

  it("isMatch returns true for exact path", () => {
    expect(
      svc.isMatch(
        [{ method: "GET", path: "/health", scope: "platform" }],
        "GET",
        "/health",
      ),
    ).toBe(true);
  });

  it("isMatch returns false when method differs", () => {
    expect(
      svc.isMatch(
        [{ method: "POST", path: "/x", scope: "platform" }],
        "GET",
        "/x",
      ),
    ).toBe(false);
  });

  it("isMatch honors :param segments", () => {
    expect(
      svc.isMatch(
        [{ method: "GET", path: "/users/:id", scope: "platform" }],
        "GET",
        "/users/42",
      ),
    ).toBe(true);
  });
});
