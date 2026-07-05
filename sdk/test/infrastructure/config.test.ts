import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError } from "../../src/domain/errors.js";
import {
  DEFAULT_BASE_URL,
  resolveConfig,
} from "../../src/infrastructure/config.js";

const FULL_ENV = {
  YOIZEN_TENANT: "envtenant",
  YOIZEN_EMAIL: "env@x.com",
  YOIZEN_PASSWORD: "envpw",
};

test("args take precedence over env", () => {
  const cfg = resolveConfig(
    { tenant: "a", email: "e@x.com", password: "p" },
    FULL_ENV
  );
  assert.equal(cfg.tenant, "a");
  assert.equal(cfg.email, "e@x.com");
  assert.equal(cfg.password, "p");
});

test("falls back to env when args are missing", () => {
  const cfg = resolveConfig({}, FULL_ENV);
  assert.equal(cfg.tenant, "envtenant");
  assert.equal(cfg.email, "env@x.com");
});

test("missing required fields throw ConfigError", () => {
  assert.throws(() => resolveConfig({}, {}), ConfigError);
  assert.throws(
    () => resolveConfig({ tenant: "t", email: "e@x.com" }, {}),
    ConfigError
  );
});

test("baseUrl defaults and strips trailing slashes", () => {
  assert.equal(resolveConfig({}, FULL_ENV).baseUrl, DEFAULT_BASE_URL);
  assert.equal(
    resolveConfig({ baseUrl: "http://x/" }, FULL_ENV).baseUrl,
    "http://x"
  );
  assert.equal(
    resolveConfig({ baseUrl: "http://x///" }, FULL_ENV).baseUrl,
    "http://x"
  );
});

test("defaultFrom defaults to email", () => {
  const cfg = resolveConfig(
    { tenant: "t", email: "e@x.com", password: "p" },
    {}
  );
  assert.equal(cfg.defaultFrom, "e@x.com");
});

test("returns a frozen config", () => {
  const cfg = resolveConfig({}, FULL_ENV);
  assert.equal(Object.isFrozen(cfg), true);
});
