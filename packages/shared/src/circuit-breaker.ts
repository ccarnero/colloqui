/**
 * Distributed circuit breaker backed by Redis.
 *
 * Architectural intent (see `.cursor/plans/scale-consumers-10_*.plan.md`
 * §6.1): convergence across N replicas cannot be achieved with a
 * per-pod breaker because each pod would need to observe
 * `failureThreshold` failures before opening. With 10 replicas and
 * threshold=5 that means ~50 upstream failures per tenant before the
 * breaker trips anywhere. A shared state in Redis converges on the
 * first 5 failures regardless of which pod sees them.
 *
 * Atomicity: all state transitions happen inside Redis via Lua
 * scripts loaded once at boot, then invoked via `EVALSHA` (1 RTT per
 * decision, O(1)). Scripts are re-loaded automatically on `NOSCRIPT`.
 *
 * Hot-path optimization: a short L1 cache (default 500 ms) memoizes
 * DENY decisions only — ALLOW always hits Redis so a freshly-opened
 * breaker in another pod converges within one RTT. The asymmetry is
 * intentional: cheap fast-fail when broken, coherent allow when not.
 *
 * Degraded mode: on any Redis error (timeout, connection refused,
 * NOSCRIPT after retry) we fall back to a local in-memory breaker.
 * This is fail-open w.r.t. the *distributed* semantics: we keep
 * serving traffic rather than blocking the platform when Redis is
 * unhealthy. Local isolation per pod still happens — we just lose
 * global convergence until Redis recovers.
 */

/**
 * Minimal structural contract for the Redis client we depend on.
 * Matches the shape of `ioredis.Redis` for the methods we use,
 * but does NOT force consumers of `@yoizen/shared` to pull in
 * `ioredis` at compile time. Any client with the same surface
 * (real ioredis, a test double, a cluster client) works.
 */
export interface ICircuitBreakerRedis {
  scriptLoad(script: string): Promise<string>;
  evalsha(
    sha: string,
    numKeys: number,
    ...keysAndArgs: Array<string | number>
  ): Promise<unknown>;
  eval(
    script: string,
    numKeys: number,
    ...keysAndArgs: Array<string | number>
  ): Promise<unknown>;
}

/**
 * Minimal structural logger contract. Compatible with
 * `PinoLoggerService` from `@yoizen/observability`. Kept here to
 * avoid a cross-package dependency.
 */
export interface ICircuitBreakerLogger {
  warn(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

/**
 * Optional metrics sink. Consumers provide a concrete implementation
 * (e.g. an OTEL-backed one from `@yoizen/observability`). Left
 * optional so tests / bootstrap code can skip instrumentation.
 *
 * `key` is the logical breaker key (tenant+endpoint, tenant+provider,
 * etc.); callers choose whether to expose it as a metric label or
 * hash it for cardinality control.
 */
export interface ICircuitBreakerMetrics {
  recordDecision(
    key: string,
    action: "allow" | "deny",
    status: BreakerStatus,
    reason: string,
  ): void;
  recordTransition(key: string, from: BreakerStatus, to: BreakerStatus): void;
  recordL1Hit(key: string): void;
  recordRedisError(): void;
  recordDecideDuration(ms: number): void;
}

export type BreakerStatus = "closed" | "open" | "half_open";

export type BreakerDecision =
  | { action: "allow"; status: BreakerStatus; reason: string }
  | {
      action: "deny";
      status: Exclude<BreakerStatus, "closed">;
      reason: string;
    };

export interface IBreakerConfig {
  /** Failures in `windowMs` before the breaker trips OPEN. */
  failureThreshold: number;
  /** Rolling window for counting failures (ms). */
  windowMs: number;
  /** How long the breaker stays OPEN before allowing a probe (ms). */
  cooldownMs: number;
  /**
   * Successive successes in HALF_OPEN required to transition to
   * CLOSED and release the probe lock.
   */
  successThreshold: number;
  /**
   * How long a single probe is allowed to hold the lock (ms). After
   * expiry another pod may acquire the probe. Typically ≥ the worst
   * realistic single-call latency.
   */
  probeTimeoutMs: number;
  /**
   * Local cache TTL for DENY decisions (ms). Set to 0 to disable.
   * Always hot-bypass is false for ALLOW.
   */
  l1CacheMs: number;
  /**
   * When Redis errors, how the library behaves:
   * - "allow": fall back to a local in-memory breaker (default).
   * - "deny": fail closed — safer for dangerous upstreams but rare.
   */
  fallbackOnRedisError: "allow" | "deny";
  /**
   * Redis call soft-timeout in ms. If exceeded, we treat it as a
   * Redis error and trigger the fallback path. Typical intra-cluster
   * redis is ~0.3 ms P50, so 100 ms is generous.
   */
  redisTimeoutMs?: number;
  /**
   * Namespace prefix for every Redis key created by this instance.
   * Default "cb". Separate services can share one Redis without
   * collisions by passing e.g. "cb:workflow" vs "cb:egress".
   */
  keyPrefix?: string;
}

const DEFAULT_CONFIG: Required<
  Omit<IBreakerConfig, "fallbackOnRedisError" | "keyPrefix" | "redisTimeoutMs">
> = {
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 30_000,
  successThreshold: 2,
  probeTimeoutMs: 60_000,
  l1CacheMs: 500,
};

/**
 * Lua — atomic decision on whether to allow a request right now.
 *
 * Returns `{action, status, reason}` as an array of strings so the
 * client can read it from a single round trip without follow-up
 * GETs. All transitions driven purely by elapsed time so the library
 * does not need a ticker.
 */
const LUA_DECIDE = `
local now      = tonumber(ARGV[1])
local probeTTL = tonumber(ARGV[2])

local state = redis.call("HGETALL", KEYS[1])
if #state == 0 then
  return {"allow", "closed", "fresh"}
end

local h = {}
for i = 1, #state, 2 do h[state[i]] = state[i+1] end

local status = h["status"] or "closed"
local openUntil = tonumber(h["open_until_ms"]) or 0

if status == "open" then
  if now >= openUntil then
    local got = redis.call("SET", KEYS[2], "1", "NX", "PX", probeTTL)
    if got then
      redis.call("HSET", KEYS[1], "status", "half_open", "last_updated_ms", now)
      return {"allow", "half_open", "probe"}
    else
      return {"deny", "half_open", "probe_in_flight"}
    end
  else
    return {"deny", "open", "cooldown"}
  end
elseif status == "half_open" then
  local probe = redis.call("GET", KEYS[2])
  if probe then
    return {"deny", "half_open", "probe_in_flight"}
  else
    redis.call("SET", KEYS[2], "1", "NX", "PX", probeTTL)
    return {"allow", "half_open", "probe_retry"}
  end
end

return {"allow", "closed", ""}
`;

/**
 * Lua — record a failure. Resets the rolling count when the window
 * since the last failure has elapsed, increments otherwise, and
 * trips to OPEN once the threshold is crossed.
 */
const LUA_RECORD_FAILURE = `
local now   = tonumber(ARGV[1])
local win   = tonumber(ARGV[2])
local thr   = tonumber(ARGV[3])
local cool  = tonumber(ARGV[4])

local prevStatus = redis.call("HGET", KEYS[1], "status") or "closed"
local lastMs = tonumber(redis.call("HGET", KEYS[1], "last_failure_ms") or "0")
if (now - lastMs) > win then
  redis.call("HSET", KEYS[1], "failures", "0")
end

local failures = tonumber(redis.call("HINCRBY", KEYS[1], "failures", 1))
redis.call("HSET", KEYS[1], "last_failure_ms", now, "last_updated_ms", now)
redis.call("PEXPIRE", KEYS[1], win + cool + 10000)

if prevStatus == "half_open" then
  redis.call("DEL", KEYS[2])
  redis.call("HSET", KEYS[1],
    "status", "open",
    "open_until_ms", now + cool,
    "successes", "0",
    "failures", "0"
  )
  return {"reopened", tostring(failures), prevStatus, "open"}
end

if failures >= thr and prevStatus ~= "open" then
  redis.call("HSET", KEYS[1],
    "status", "open",
    "open_until_ms", now + cool,
    "successes", "0"
  )
  return {"opened", tostring(failures), prevStatus, "open"}
end

return {"counted", tostring(failures), prevStatus, prevStatus}
`;

/**
 * Lua — record a success. In HALF_OPEN, advance success count and
 * close once threshold is reached (releasing the probe lock). In
 * CLOSED, reset the failure counter so we don't cumulate from
 * ancient failures (the rolling window already handles this but
 * resetting is cheaper than re-expiring on every decision).
 */
const LUA_RECORD_SUCCESS = `
local status = redis.call("HGET", KEYS[1], "status") or "closed"
if status == "half_open" then
  local successes = tonumber(redis.call("HINCRBY", KEYS[1], "successes", 1))
  if successes >= tonumber(ARGV[1]) then
    redis.call("DEL", KEYS[2])
    redis.call("HSET", KEYS[1],
      "status", "closed",
      "failures", "0",
      "successes", "0",
      "last_updated_ms", tonumber(ARGV[2])
    )
    return {"closed", tostring(successes), "half_open", "closed"}
  end
  return {"probe_ok", tostring(successes), "half_open", "half_open"}
elseif status == "closed" then
  redis.call("HSET", KEYS[1], "failures", "0", "last_updated_ms", tonumber(ARGV[2]))
  return {"ok", "0", "closed", "closed"}
end
return {"noop", "0", status, status}
`;

type ScriptName = "decide" | "rf" | "rs";

interface IL1Entry {
  decision: BreakerDecision;
  expiresAt: number;
}

interface ILocalEntry {
  failures: number;
  status: BreakerStatus;
  openUntil: number;
  successes: number;
  lastFailureMs: number;
}

/**
 * In-process last-resort breaker used when Redis is unreachable.
 * Same interface as the distributed one at the observable boundary
 * but NOT shared across pods — each pod will converge independently.
 *
 * Kept deliberately minimal: no Lua, no RTT, O(1) Map lookups.
 */
class LocalFallbackBreaker {
  private readonly state = new Map<string, ILocalEntry>();

  constructor(private readonly config: Required<Omit<IBreakerConfig, "fallbackOnRedisError" | "keyPrefix" | "redisTimeoutMs">>) {}

  canProceed(key: string): BreakerDecision {
    const now = Date.now();
    const entry = this.state.get(key);
    if (!entry) return { action: "allow", status: "closed", reason: "fresh" };

    if (entry.status === "open") {
      if (now >= entry.openUntil) {
        entry.status = "half_open";
        return { action: "allow", status: "half_open", reason: "probe" };
      }
      return { action: "deny", status: "open", reason: "cooldown" };
    }
    return { action: "allow", status: entry.status, reason: "" };
  }

  recordFailure(key: string): void {
    const now = Date.now();
    let entry = this.state.get(key);
    if (!entry) {
      entry = {
        failures: 0,
        status: "closed",
        openUntil: 0,
        successes: 0,
        lastFailureMs: 0,
      };
      this.state.set(key, entry);
    }
    if (now - entry.lastFailureMs > this.config.windowMs) entry.failures = 0;
    entry.failures += 1;
    entry.lastFailureMs = now;

    if (entry.status === "half_open") {
      entry.status = "open";
      entry.openUntil = now + this.config.cooldownMs;
      entry.successes = 0;
      entry.failures = 0;
      return;
    }
    if (
      entry.failures >= this.config.failureThreshold &&
      entry.status !== "open"
    ) {
      entry.status = "open";
      entry.openUntil = now + this.config.cooldownMs;
      entry.successes = 0;
    }
  }

  recordSuccess(key: string): void {
    const entry = this.state.get(key);
    if (!entry) return;
    if (entry.status === "half_open") {
      entry.successes += 1;
      if (entry.successes >= this.config.successThreshold) {
        entry.status = "closed";
        entry.failures = 0;
        entry.successes = 0;
      }
    } else if (entry.status === "closed") {
      entry.failures = 0;
    }
  }

  getStatus(key: string): BreakerStatus {
    return this.state.get(key)?.status ?? "closed";
  }
}

/**
 * Distributed circuit breaker with a local fallback.
 *
 * Usage:
 *   const cb = new DistributedCircuitBreaker(redis, config, logger, metrics);
 *   const d = await cb.canProceed(key);
 *   if (d.action === "deny") { // fast-fail ... }
 *   try { ...; cb.recordSuccess(key); }
 *   catch { cb.recordFailure(key); throw; }
 */
export class DistributedCircuitBreaker {
  private readonly resolved: Required<
    Omit<IBreakerConfig, "keyPrefix" | "redisTimeoutMs">
  > & { keyPrefix: string; redisTimeoutMs: number };

  /** EVALSHA target per script, populated on `scriptLoad`. */
  private readonly shas = new Map<ScriptName, string>();
  private scriptsLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  /**
   * L1 cache for DENY decisions only (ALLOW is never cached so a
   * breaker flipping to OPEN in another pod converges on the very
   * next RTT). Map → O(1) lookup. Swept opportunistically.
   */
  private readonly l1 = new Map<string, IL1Entry>();

  private readonly fallback: LocalFallbackBreaker;

  /** Cheap periodic sweep so the L1 cache can never grow unbounded. */
  private lastSweepMs = 0;
  private static readonly L1_SWEEP_INTERVAL_MS = 10_000;

  constructor(
    private readonly redis: ICircuitBreakerRedis,
    config: IBreakerConfig,
    private readonly logger: ICircuitBreakerLogger,
    private readonly metrics?: ICircuitBreakerMetrics,
  ) {
    this.resolved = {
      failureThreshold: config.failureThreshold ?? DEFAULT_CONFIG.failureThreshold,
      windowMs: config.windowMs ?? DEFAULT_CONFIG.windowMs,
      cooldownMs: config.cooldownMs ?? DEFAULT_CONFIG.cooldownMs,
      successThreshold:
        config.successThreshold ?? DEFAULT_CONFIG.successThreshold,
      probeTimeoutMs:
        config.probeTimeoutMs ?? DEFAULT_CONFIG.probeTimeoutMs,
      l1CacheMs: config.l1CacheMs ?? DEFAULT_CONFIG.l1CacheMs,
      fallbackOnRedisError: config.fallbackOnRedisError ?? "allow",
      keyPrefix: config.keyPrefix ?? "cb",
      redisTimeoutMs: config.redisTimeoutMs ?? 100,
    };
    this.fallback = new LocalFallbackBreaker(this.resolved);
  }

  /**
   * Load all 3 Lua scripts into Redis once and cache their SHA1s.
   * Called lazily on first use; safe to call explicitly at boot to
   * pre-warm and fail fast.
   */
  async scriptLoad(): Promise<void> {
    if (this.scriptsLoaded) return;
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }
    this.loadingPromise = (async () => {
      const [decide, rf, rs] = await Promise.all([
        this.redis.scriptLoad(LUA_DECIDE),
        this.redis.scriptLoad(LUA_RECORD_FAILURE),
        this.redis.scriptLoad(LUA_RECORD_SUCCESS),
      ]);
      this.shas.set("decide", decide);
      this.shas.set("rf", rf);
      this.shas.set("rs", rs);
      this.scriptsLoaded = true;
    })();
    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * Synchronous decision path — 1 round trip to Redis or 0 on L1 hit.
   * Non-throwing: on Redis error we record it and defer to the local
   * fallback so the caller can always make progress.
   */
  async canProceed(key: string): Promise<BreakerDecision> {
    const now = Date.now();

    if (this.resolved.l1CacheMs > 0) {
      const cached = this.l1.get(key);
      if (cached && cached.expiresAt > now) {
        if (cached.decision.action === "deny") {
          this.metrics?.recordL1Hit(key);
          this.metrics?.recordDecision(
            key,
            "deny",
            cached.decision.status,
            cached.decision.reason,
          );
          return cached.decision;
        }
      }
    }

    const start = performance.now();
    try {
      const decision = await this.execDecide(key, now);
      this.metrics?.recordDecideDuration(performance.now() - start);
      if (decision.action === "deny" && this.resolved.l1CacheMs > 0) {
        this.l1.set(key, {
          decision,
          expiresAt: Date.now() + this.resolved.l1CacheMs,
        });
        this.maybeSweepL1(now);
      }
      this.metrics?.recordDecision(
        key,
        decision.action,
        decision.status,
        decision.reason,
      );
      return decision;
    } catch (err) {
      this.handleRedisError("canProceed", err);
      const local = this.fallback.canProceed(key);
      this.metrics?.recordDecision(
        key,
        local.action,
        local.status,
        local.reason ?? "fallback",
      );
      if (this.resolved.fallbackOnRedisError === "deny") {
        return {
          action: "deny",
          status: "open",
          reason: "redis_unavailable",
        };
      }
      return local;
    }
  }

  /**
   * Fire-and-forget failure record. Never blocks the caller; never
   * throws. Failures to update Redis are logged and the local
   * fallback is advanced so the pod still has a coherent view.
   */
  recordFailure(key: string): void {
    this.fallback.recordFailure(key);
    this.invalidateL1(key);
    void this.execRecordFailure(key).catch((err) =>
      this.handleRedisError("recordFailure", err),
    );
  }

  /**
   * Fire-and-forget success record. See `recordFailure`.
   */
  recordSuccess(key: string): void {
    this.fallback.recordSuccess(key);
    this.invalidateL1(key);
    void this.execRecordSuccess(key).catch((err) =>
      this.handleRedisError("recordSuccess", err),
    );
  }

  /**
   * Observability helper — returns the authoritative status from
   * Redis, falling back to the local view on error.
   */
  async getStatus(key: string): Promise<BreakerStatus> {
    try {
      await this.ensureLoaded();
      const [action] = (await this.withTimeout(
        this.redis.evalsha(
          this.shas.get("decide") as string,
          2,
          this.stateKey(key),
          this.probeKey(key),
          String(Date.now()),
          String(this.resolved.probeTimeoutMs),
        ),
      )) as [string, BreakerStatus, string];
      if (action === "allow") return "closed";
      return "open";
    } catch {
      return this.fallback.getStatus(key);
    }
  }

  /**
   * @internal Testing hook. Not part of the public API contract.
   */
  clearL1ForTests(): void {
    this.l1.clear();
  }

  private stateKey(key: string): string {
    return `${this.resolved.keyPrefix}:${key}`;
  }

  private probeKey(key: string): string {
    return `${this.resolved.keyPrefix}:probe:${key}`;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.scriptsLoaded) await this.scriptLoad();
  }

  private async execDecide(
    key: string,
    now: number,
  ): Promise<BreakerDecision> {
    await this.ensureLoaded();
    const raw = await this.evalWithRetry(
      "decide",
      LUA_DECIDE,
      2,
      this.stateKey(key),
      this.probeKey(key),
      String(now),
      String(this.resolved.probeTimeoutMs),
    );
    return parseDecision(raw);
  }

  private async execRecordFailure(key: string): Promise<void> {
    await this.ensureLoaded();
    const now = Date.now();
    const raw = (await this.evalWithRetry(
      "rf",
      LUA_RECORD_FAILURE,
      2,
      this.stateKey(key),
      this.probeKey(key),
      String(now),
      String(this.resolved.windowMs),
      String(this.resolved.failureThreshold),
      String(this.resolved.cooldownMs),
    )) as [string, string, BreakerStatus, BreakerStatus];
    this.emitTransition(key, raw);
  }

  private async execRecordSuccess(key: string): Promise<void> {
    await this.ensureLoaded();
    const now = Date.now();
    const raw = (await this.evalWithRetry(
      "rs",
      LUA_RECORD_SUCCESS,
      2,
      this.stateKey(key),
      this.probeKey(key),
      String(this.resolved.successThreshold),
      String(now),
    )) as [string, string, BreakerStatus, BreakerStatus];
    this.emitTransition(key, raw);
  }

  /**
   * EVALSHA with a single NOSCRIPT fallback to plain EVAL. This
   * keeps us at 1 RTT in the steady state while still self-healing
   * if Redis was flushed or failed over to a new master without the
   * scripts loaded.
   */
  private async evalWithRetry(
    name: ScriptName,
    script: string,
    numKeys: number,
    ...keysAndArgs: string[]
  ): Promise<unknown> {
    const sha = this.shas.get(name);
    if (sha) {
      try {
        return await this.withTimeout(
          this.redis.evalsha(sha, numKeys, ...keysAndArgs),
        );
      } catch (err) {
        if (!isNoScriptError(err)) throw err;
        // fall through to EVAL + reload
      }
    }
    const loadedSha = await this.redis.scriptLoad(script);
    this.shas.set(name, loadedSha);
    return this.withTimeout(this.redis.eval(script, numKeys, ...keysAndArgs));
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    if (this.resolved.redisTimeoutMs <= 0) return p;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("redis_timeout")),
        this.resolved.redisTimeoutMs,
      );
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private emitTransition(
    key: string,
    raw: [string, string, BreakerStatus, BreakerStatus],
  ): void {
    if (!this.metrics) return;
    const [, , from, to] = raw;
    if (from && to && from !== to) {
      this.metrics.recordTransition(key, from, to);
    }
  }

  private handleRedisError(op: string, err: unknown): void {
    this.metrics?.recordRedisError();
    this.logger.warn(
      `circuit_breaker redis error in ${op}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  private invalidateL1(key: string): void {
    this.l1.delete(key);
  }

  private maybeSweepL1(now: number): void {
    if (now - this.lastSweepMs < DistributedCircuitBreaker.L1_SWEEP_INTERVAL_MS)
      return;
    this.lastSweepMs = now;
    for (const [k, entry] of this.l1) {
      if (entry.expiresAt <= now) this.l1.delete(k);
    }
  }
}

function parseDecision(raw: unknown): BreakerDecision {
  const arr = raw as [string, string, string];
  const [action, status, reason] = arr;
  if (action === "allow") {
    return {
      action: "allow",
      status: (status as BreakerStatus) ?? "closed",
      reason: reason ?? "",
    };
  }
  return {
    action: "deny",
    status: (status as Exclude<BreakerStatus, "closed">) ?? "open",
    reason: reason ?? "",
  };
}

function isNoScriptError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return msg.includes("NOSCRIPT");
}

/**
 * Convenience helper to build a breaker key from structured inputs.
 * Keeping it a pure function (no allocation of intermediate arrays)
 * keeps the hot path clean — activities call this once per request.
 *
 * Colons are escaped to "_" in each part to prevent a rogue id from
 * injecting sub-structure into the key.
 */
export function computeBreakerKey(parts: {
  tenantId: string;
  [k: string]: string | undefined;
}): string {
  const out: string[] = [escape(parts.tenantId)];
  for (const k of Object.keys(parts)) {
    if (k === "tenantId") continue;
    const v = parts[k];
    if (v !== undefined) out.push(escape(v));
  }
  return out.join(":");
}

function escape(s: string): string {
  return s.indexOf(":") === -1 ? s : s.replace(/:/g, "_");
}
