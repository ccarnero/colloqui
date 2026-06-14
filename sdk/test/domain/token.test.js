import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeToken,
  isExpired,
  canRefresh,
  tenantFromScope,
} from "../../src/domain/token.js";

test("makeToken computes expiry from obtainedAt + expiresIn", () => {
  const t = makeToken({ accessToken: "a", expiresIn: 3600, obtainedAt: 0 });
  assert.equal(t.expiresAt, 3_600_000);
});

test("isExpired respects the early-refresh buffer", () => {
  const t = makeToken({ accessToken: "a", expiresIn: 3600, obtainedAt: 0 });
  assert.equal(isExpired(t, 3_540_000, 60_000), true); // exactly at expiry - buffer
  assert.equal(isExpired(t, 3_539_999, 60_000), false);
});

test("isExpired is true for a missing token", () => {
  assert.equal(isExpired(null, 0, 0), true);
  assert.equal(isExpired(undefined, 0, 0), true);
});

test("tenantFromScope extracts the tenant slug", () => {
  assert.equal(tenantFromScope("tenant:acme"), "acme");
  assert.equal(tenantFromScope("tenant:t1"), "t1");
});

test("tenantFromScope returns null for platform/malformed scopes", () => {
  assert.equal(tenantFromScope("platform"), null);
  assert.equal(tenantFromScope("garbage"), null);
  assert.equal(tenantFromScope(undefined), null);
});

test("canRefresh requires a refresh token within its TTL", () => {
  const t = makeToken({
    accessToken: "a",
    expiresIn: 3600,
    refreshToken: "r",
    obtainedAt: 0,
  });
  assert.equal(canRefresh(t, 1000), true);
  assert.equal(canRefresh(t, 86_400 * 1000 + 1), false);

  const noRefresh = makeToken({ accessToken: "a", expiresIn: 3600, obtainedAt: 0 });
  assert.equal(canRefresh(noRefresh, 0), false);
});
