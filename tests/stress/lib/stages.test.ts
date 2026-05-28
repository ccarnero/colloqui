import { describe, expect, test } from "bun:test";

import { buildPhase1ScenarioOptions } from "./stages";

describe("buildPhase1ScenarioOptions", () => {
  test("uses each stage rate as the ramping-arrival start rate", () => {
    const previousEnv = (globalThis as { __ENV?: Record<string, string> }).__ENV;
    (globalThis as { __ENV?: Record<string, string> }).__ENV = {
      STRESS_BASELINE_DURATION: "0s",
      STRESS_LIGHT_DURATION: "0s",
      STRESS_MEDIUM_DURATION: "30s",
      STRESS_HEAVY_DURATION: "0s",
      STRESS_PEAK_DURATION: "0s",
      STRESS_SPIKE_RAMP: "0s",
      STRESS_SPIKE_HOLD: "0s",
      STRESS_MEDIUM_RATE: "25",
      STRESS_MEDIUM_VUS: "10",
    };

    try {
      const scenarios = buildPhase1ScenarioOptions();

      expect(scenarios.medium).toMatchObject({
        executor: "ramping-arrival-rate",
        startRate: 25,
        stages: [{ duration: "30s", target: 25 }],
      });
    } finally {
      if (previousEnv) {
        (globalThis as { __ENV?: Record<string, string> }).__ENV = previousEnv;
      } else {
        delete (globalThis as { __ENV?: Record<string, string> }).__ENV;
      }
    }
  });
});
