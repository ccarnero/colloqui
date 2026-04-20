import { describe, it, expect, beforeEach } from "bun:test";
import {
  DistributedCircuitBreaker,
  computeBreakerKey,
  type BreakerStatus,
  type ICircuitBreakerRedis,
  type ICircuitBreakerLogger,
  type ICircuitBreakerMetrics,
} from "../../src/circuit-breaker";

/**
 * A deterministic in-memory Redis fake that executes our Lua scripts
 * by name. We don't need a full Lua VM — we re-implement the exact
 * state transitions that LUA_DECIDE / LUA_RECORD_FAILURE /
 * LUA_RECORD_SUCCESS perform, labeled by SHA so we can also assert
 * that `evalsha` is used (covered implicitly through behavior).
 */
function makeFakeRedis(): {
  redis: ICircuitBreakerRedis;
  scripts: Map<string, string>;
  clock: { now: number };
  state: Map<string, Map<string, string>>;
  probeLocks: Map<string, { value: string; expiresAt: number }>;
} {
  const clock = { now: 1_000_000 };
  const scripts = new Map<string, string>();
  const state = new Map<string, Map<string, string>>();
  const probeLocks = new Map<
    string,
    { value: string; expiresAt: number }
  >();

  function getHash(key: string): Map<string, string> {
    let h = state.get(key);
    if (!h) {
      h = new Map();
      state.set(key, h);
    }
    return h;
  }

  function hasProbe(key: string): boolean {
    const p = probeLocks.get(key);
    if (!p) return false;
    if (p.expiresAt <= clock.now) {
      probeLocks.delete(key);
      return false;
    }
    return true;
  }

  function acquireProbe(key: string, ttlMs: number): boolean {
    if (hasProbe(key)) return false;
    probeLocks.set(key, { value: "1", expiresAt: clock.now + ttlMs });
    return true;
  }

  function runDecide(
    stateKey: string,
    probeKey: string,
    nowMs: number,
    probeTTL: number,
  ): [string, string, string] {
    clock.now = nowMs;
    const h = state.get(stateKey);
    if (!h || h.size === 0) return ["allow", "closed", "fresh"];
    const status = (h.get("status") ?? "closed") as BreakerStatus;
    const openUntil = Number(h.get("open_until_ms") ?? "0");
    if (status === "open") {
      if (nowMs >= openUntil) {
        if (acquireProbe(probeKey, probeTTL)) {
          getHash(stateKey).set("status", "half_open");
          getHash(stateKey).set("last_updated_ms", String(nowMs));
          return ["allow", "half_open", "probe"];
        }
        return ["deny", "half_open", "probe_in_flight"];
      }
      return ["deny", "open", "cooldown"];
    }
    if (status === "half_open") {
      if (hasProbe(probeKey)) return ["deny", "half_open", "probe_in_flight"];
      acquireProbe(probeKey, probeTTL);
      return ["allow", "half_open", "probe_retry"];
    }
    return ["allow", "closed", ""];
  }

  function runRecordFailure(
    stateKey: string,
    probeKey: string,
    nowMs: number,
    windowMs: number,
    threshold: number,
    cooldownMs: number,
  ): [string, string, BreakerStatus, BreakerStatus] {
    clock.now = nowMs;
    const h = getHash(stateKey);
    const prevStatus = (h.get("status") ?? "closed") as BreakerStatus;
    const lastMs = Number(h.get("last_failure_ms") ?? "0");
    if (nowMs - lastMs > windowMs) h.set("failures", "0");
    const failures = Number(h.get("failures") ?? "0") + 1;
    h.set("failures", String(failures));
    h.set("last_failure_ms", String(nowMs));
    h.set("last_updated_ms", String(nowMs));

    if (prevStatus === "half_open") {
      probeLocks.delete(probeKey);
      h.set("status", "open");
      h.set("open_until_ms", String(nowMs + cooldownMs));
      h.set("successes", "0");
      h.set("failures", "0");
      return ["reopened", String(failures), prevStatus, "open"];
    }

    if (failures >= threshold && prevStatus !== "open") {
      h.set("status", "open");
      h.set("open_until_ms", String(nowMs + cooldownMs));
      h.set("successes", "0");
      return ["opened", String(failures), prevStatus, "open"];
    }
    return ["counted", String(failures), prevStatus, prevStatus];
  }

  function runRecordSuccess(
    stateKey: string,
    probeKey: string,
    successThreshold: number,
    nowMs: number,
  ): [string, string, BreakerStatus, BreakerStatus] {
    clock.now = nowMs;
    const h = getHash(stateKey);
    const status = (h.get("status") ?? "closed") as BreakerStatus;
    if (status === "half_open") {
      const s = Number(h.get("successes") ?? "0") + 1;
      h.set("successes", String(s));
      if (s >= successThreshold) {
        probeLocks.delete(probeKey);
        h.set("status", "closed");
        h.set("failures", "0");
        h.set("successes", "0");
        h.set("last_updated_ms", String(nowMs));
        return ["closed", String(s), "half_open", "closed"];
      }
      return ["probe_ok", String(s), "half_open", "half_open"];
    }
    if (status === "closed") {
      h.set("failures", "0");
      h.set("last_updated_ms", String(nowMs));
      return ["ok", "0", "closed", "closed"];
    }
    return ["noop", "0", status, status];
  }

  const redis: ICircuitBreakerRedis = {
    async scriptLoad(src: string): Promise<string> {
      const sha = `sha_${scripts.size}`;
      scripts.set(sha, src);
      return sha;
    },
    async evalsha(
      sha: string,
      numKeys: number,
      ...keysAndArgs: Array<string | number>
    ): Promise<unknown> {
      const src = scripts.get(sha);
      if (!src) {
        throw new Error("NOSCRIPT No matching script");
      }
      return runByScript(src, numKeys, keysAndArgs.map(String));
    },
    async eval(
      src: string,
      numKeys: number,
      ...keysAndArgs: Array<string | number>
    ): Promise<unknown> {
      return runByScript(src, numKeys, keysAndArgs.map(String));
    },
  };

  function runByScript(
    src: string,
    _numKeys: number,
    args: string[],
  ): unknown {
    const [stateKey, probeKey, ...rest] = args;
    if (src.includes("return {\"allow\", \"closed\", \"fresh\"}")) {
      const [nowStr, ttlStr] = rest;
      return runDecide(
        stateKey!,
        probeKey!,
        Number(nowStr),
        Number(ttlStr),
      );
    }
    if (src.includes("HINCRBY KEYS[1], \"failures\"") || src.includes('"failures", 1')) {
      const [nowStr, winStr, thrStr, coolStr] = rest;
      return runRecordFailure(
        stateKey!,
        probeKey!,
        Number(nowStr),
        Number(winStr),
        Number(thrStr),
        Number(coolStr),
      );
    }
    if (src.includes('"successes", 1')) {
      const [successThrStr, nowStr] = rest;
      return runRecordSuccess(
        stateKey!,
        probeKey!,
        Number(successThrStr),
        Number(nowStr),
      );
    }
    throw new Error(`unknown script: ${src.slice(0, 40)}`);
  }

  return { redis, scripts, clock, state, probeLocks };
}

function makeLogger(): ICircuitBreakerLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warn: (msg: string) => {
      warnings.push(msg);
    },
    warnings,
  };
}

function makeMetrics(): ICircuitBreakerMetrics & {
  decisions: Array<{
    action: "allow" | "deny";
    status: BreakerStatus;
    reason: string;
  }>;
  transitions: Array<{ from: BreakerStatus; to: BreakerStatus }>;
  l1Hits: number;
  redisErrors: number;
} {
  const state = {
    decisions: [] as Array<{
      action: "allow" | "deny";
      status: BreakerStatus;
      reason: string;
    }>,
    transitions: [] as Array<{ from: BreakerStatus; to: BreakerStatus }>,
    l1Hits: 0,
    redisErrors: 0,
    recordDecision(
      _k: string,
      action: "allow" | "deny",
      status: BreakerStatus,
      reason: string,
    ) {
      state.decisions.push({ action, status, reason });
    },
    recordTransition(_k: string, from: BreakerStatus, to: BreakerStatus) {
      state.transitions.push({ from, to });
    },
    recordL1Hit() {
      state.l1Hits += 1;
    },
    recordRedisError() {
      state.redisErrors += 1;
    },
    recordDecideDuration() {
      /* noop in tests */
    },
  };
  return state;
}

describe("DistributedCircuitBreaker", () => {
  let redisFake: ReturnType<typeof makeFakeRedis>;
  let logger: ReturnType<typeof makeLogger>;
  let metrics: ReturnType<typeof makeMetrics>;
  let cb: DistributedCircuitBreaker;

  const config = {
    failureThreshold: 3,
    windowMs: 60_000,
    cooldownMs: 10_000,
    successThreshold: 2,
    probeTimeoutMs: 5_000,
    l1CacheMs: 500,
    fallbackOnRedisError: "allow" as const,
    keyPrefix: "cb",
  };

  beforeEach(async () => {
    redisFake = makeFakeRedis();
    logger = makeLogger();
    metrics = makeMetrics();
    cb = new DistributedCircuitBreaker(
      redisFake.redis,
      config,
      logger,
      metrics,
    );
    await cb.scriptLoad();
  });

  it("allows requests when the breaker is fresh / closed", async () => {
    const d = await cb.canProceed("t1:svc-a");
    expect(d.action).toBe("allow");
    expect(d.status).toBe("closed");
  });

  it("opens after failureThreshold failures and fast-fails subsequent allows", async () => {
    const key = "t1:svc-a";
    cb.recordFailure(key);
    cb.recordFailure(key);
    cb.recordFailure(key);
    await new Promise((r) => setTimeout(r, 10));

    const d = await cb.canProceed(key);
    expect(d.action).toBe("deny");
    expect(d.status).toBe("open");
    expect(d.reason).toBe("cooldown");
  });

  it("transitions to half_open after cooldown and lets exactly one probe pass", async () => {
    const key = "t1:svc-probe";
    cb.recordFailure(key);
    cb.recordFailure(key);
    cb.recordFailure(key);
    await new Promise((r) => setTimeout(r, 5));

    redisFake.clock.now = Date.now() + 20_000;
    const realNow = Date.now;
    (Date.now as any) = () => redisFake.clock.now;
    try {
      const a = await cb.canProceed(key);
      const b = await cb.canProceed(key);
      expect(a.action).toBe("allow");
      expect(a.status).toBe("half_open");
      expect(b.action).toBe("deny");
      expect(b.status).toBe("half_open");
      expect(b.reason).toBe("probe_in_flight");
    } finally {
      Date.now = realNow;
    }
  });

  it("closes from half_open after successThreshold consecutive successes", async () => {
    const key = "t1:svc-close";
    cb.recordFailure(key);
    cb.recordFailure(key);
    cb.recordFailure(key);
    await new Promise((r) => setTimeout(r, 20));

    const realNow = Date.now;
    redisFake.clock.now = realNow() + 20_000;
    (Date.now as any) = () => redisFake.clock.now;

    try {
      const probe = await cb.canProceed(key);
      expect(probe.action).toBe("allow");
      expect(probe.status).toBe("half_open");

      cb.recordSuccess(key);
      await new Promise((r) => setTimeout(r, 10));
      cb.recordSuccess(key);
      await new Promise((r) => setTimeout(r, 10));

      cb.clearL1ForTests();
      const after = await cb.canProceed(key);
      expect(after.action).toBe("allow");
      expect(after.status).toBe("closed");
    } finally {
      Date.now = realNow;
    }
  });

  it("reopens immediately if a probe fails in half_open", async () => {
    const key = "t1:svc-reopen";
    cb.recordFailure(key);
    cb.recordFailure(key);
    cb.recordFailure(key);
    await new Promise((r) => setTimeout(r, 5));

    const realNow = Date.now;
    redisFake.clock.now = realNow() + 20_000;
    (Date.now as any) = () => redisFake.clock.now;
    try {
      const probe = await cb.canProceed(key);
      expect(probe.status).toBe("half_open");

      cb.recordFailure(key);
      await new Promise((r) => setTimeout(r, 5));

      redisFake.clock.now += 1_000;
      const d = await cb.canProceed(key);
      expect(d.action).toBe("deny");
      expect(d.status).toBe("open");
    } finally {
      Date.now = realNow;
    }
  });

  it("caches DENY decisions in L1 and serves them without hitting Redis", async () => {
    const key = "t1:svc-l1";
    cb.recordFailure(key);
    cb.recordFailure(key);
    cb.recordFailure(key);
    await new Promise((r) => setTimeout(r, 5));

    const d1 = await cb.canProceed(key);
    expect(d1.action).toBe("deny");

    const evalShaOrig = redisFake.redis.evalsha;
    let calls = 0;
    redisFake.redis.evalsha = async (
      ...args: Parameters<typeof evalShaOrig>
    ) => {
      calls += 1;
      return evalShaOrig.apply(redisFake.redis, args);
    };

    const d2 = await cb.canProceed(key);
    expect(d2.action).toBe("deny");
    expect(calls).toBe(0);
    expect(metrics.l1Hits).toBeGreaterThan(0);
  });

  it("does NOT cache ALLOW decisions — they always re-check Redis", async () => {
    const key = "t1:svc-allow";
    const d1 = await cb.canProceed(key);
    expect(d1.action).toBe("allow");

    let calls = 0;
    const orig = redisFake.redis.evalsha;
    redisFake.redis.evalsha = async (...args: Parameters<typeof orig>) => {
      calls += 1;
      return orig.apply(redisFake.redis, args);
    };

    await cb.canProceed(key);
    await cb.canProceed(key);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("falls back to local breaker on Redis errors and continues serving traffic", async () => {
    const key = "t1:svc-degraded";
    redisFake.redis.evalsha = async () => {
      throw new Error("connection refused");
    };
    redisFake.redis.eval = async () => {
      throw new Error("connection refused");
    };

    const d = await cb.canProceed(key);
    expect(d.action).toBe("allow");
    expect(metrics.redisErrors).toBeGreaterThan(0);
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  it("fails CLOSED when fallbackOnRedisError = 'deny'", async () => {
    const cbDeny = new DistributedCircuitBreaker(
      redisFake.redis,
      { ...config, fallbackOnRedisError: "deny" },
      logger,
      metrics,
    );
    redisFake.redis.evalsha = async () => {
      throw new Error("connection refused");
    };
    redisFake.redis.eval = async () => {
      throw new Error("connection refused");
    };
    const d = await cbDeny.canProceed("t1:svc-x");
    expect(d.action).toBe("deny");
    expect(d.status).toBe("open");
    expect(d.reason).toBe("redis_unavailable");
  });

  it("multi-instance convergence: 10 pods sharing Redis trip OPEN on total failureThreshold", async () => {
    const pods: DistributedCircuitBreaker[] = [];
    for (let i = 0; i < 10; i++) {
      const c = new DistributedCircuitBreaker(
        redisFake.redis,
        config,
        logger,
        metrics,
      );
      await c.scriptLoad();
      pods.push(c);
    }
    const key = "t1:global";
    pods[0]!.recordFailure(key);
    pods[1]!.recordFailure(key);
    pods[2]!.recordFailure(key);
    await new Promise((r) => setTimeout(r, 10));

    const decisions = await Promise.all(
      pods.map((p) => p.canProceed(key)),
    );
    for (const d of decisions) {
      expect(d.action).toBe("deny");
      expect(d.status).toBe("open");
    }
  });

  it("recovers via NOSCRIPT fallback when Redis drops cached scripts", async () => {
    const key = "t1:noscript";
    redisFake.scripts.clear();

    const d = await cb.canProceed(key);
    expect(d.action).toBe("allow");
  });
});

describe("computeBreakerKey", () => {
  it("composes tenantId + additional parts in order", () => {
    const k = computeBreakerKey({
      tenantId: "t1",
      adapterId: "a1",
      endpointId: "e1",
    });
    expect(k).toBe("t1:a1:e1");
  });

  it("skips undefined parts", () => {
    const k = computeBreakerKey({
      tenantId: "t1",
      adapterId: "a1",
      endpointId: undefined,
    });
    expect(k).toBe("t1:a1");
  });

  it("escapes colons inside parts to prevent key injection", () => {
    const k = computeBreakerKey({
      tenantId: "t:evil",
      provider: "wa",
    });
    expect(k).toBe("t_evil:wa");
  });
});
