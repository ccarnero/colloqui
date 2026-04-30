import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { SignJWT } from "jose";

const SECRET = "test-jwt-secret-key-minimum-32-characters-long!!";

describe("JwtService", () => {
  let JwtServiceClass: typeof import("../../src/modules/auth/jwt.service").JwtService;
  let jwt: InstanceType<typeof JwtServiceClass>;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    JwtServiceClass = (await import("../../src/modules/auth/jwt.service"))
      .JwtService;
  });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [JwtServiceClass],
    }).compile();
    jwt = moduleRef.get(JwtServiceClass);
    await jwt.onModuleInit();
  });

  it("verify returns payload for a valid HS256 token", async () => {
    const token = await new SignJWT({ sub: "user-1", scope: "platform" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode(SECRET));
    const payload = await jwt.verify(token);
    expect(payload.sub).toBe("user-1");
  });

  it("verify throws UnauthorizedException for invalid token", async () => {
    await expect(jwt.verify("not-a-jwt")).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
