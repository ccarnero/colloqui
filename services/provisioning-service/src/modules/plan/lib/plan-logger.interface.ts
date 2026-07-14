// Minimal logger port `buildManifestPlan` accepts — duck-type compatible
// with `PinoLoggerService` (`@yoizen/observability`) so the Nest layer can
// inject its real logger while pure unit tests pass a no-op stub. Keeps the
// planner testable without pulling NestJS/Pino into the pure `lib/` layer.

export interface PlanLogger {
  log(message: string): void;
  warn(message: string): void;
}

export const NOOP_PLAN_LOGGER: PlanLogger = {
  log: () => undefined,
  warn: () => undefined,
};
