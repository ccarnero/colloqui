import {
  type INodeStatsRow,
  mapNodeStatsToViewModels,
} from "../map-node-stats-to-view-models";

/**
 * T07 of console-redesign-builder-v2.md — mapping from the `GET
 * /node-stats` aggregate rows to per-node footer view models, keyed by
 * `action_name` (the join-crux verdict recorded in that SPEC's "T06
 * findings": the builder's node `key` is regenerated on every deserialize,
 * `action.name` is the one identity that survives end to end).
 */
describe("mapNodeStatsToViewModels", () => {
  it("maps a single-branch row to a ready view model with real numbers", () => {
    const rows: INodeStatsRow[] = [
      {
        action_name: "Fetch user",
        branch: null,
        runs: 1842,
        p95_ms: 620,
        ok_ratio: 0.99,
      },
    ];
    const result = mapNodeStatsToViewModels(rows);
    expect(result["Fetch user"]).toEqual({
      state: "ready",
      primaryLabel: "1,842 runs",
      secondaryLabel: "p95: 620ms",
      status: "ok",
    });
  });

  it("merges rows sharing the same action_name across different branches (sum runs, worst-case p95, weighted ok_ratio)", () => {
    const rows: INodeStatsRow[] = [
      {
        action_name: "Notify",
        branch: "pathA",
        runs: 10,
        p95_ms: 100,
        ok_ratio: 1,
      },
      {
        action_name: "Notify",
        branch: "pathB",
        runs: 10,
        p95_ms: 500,
        ok_ratio: 0.5,
      },
    ];
    const result = mapNodeStatsToViewModels(rows);
    expect(result["Notify"]?.primaryLabel).toBe("20 runs");
    // Worst-case (max) p95 across the merged branches, never understated.
    expect(result["Notify"]?.secondaryLabel).toBe("p95: 500ms");
    // Runs-weighted ok_ratio: (10*1 + 10*0.5) / 20 = 0.75 -> below the 0.8
    // warning floor (classify-node-run-status.ts) -> "error".
    expect(result["Notify"]?.status).toBe("error");
  });

  it("drops rows with a null/empty action_name (non-action events never reach the join)", () => {
    const rows: INodeStatsRow[] = [
      { action_name: "", branch: null, runs: 5, p95_ms: 10, ok_ratio: 1 },
    ];
    const result = mapNodeStatsToViewModels(rows);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("drops rows with zero or negative runs", () => {
    const rows: INodeStatsRow[] = [
      {
        action_name: "Idle",
        branch: null,
        runs: 0,
        p95_ms: null,
        ok_ratio: null,
      },
    ];
    const result = mapNodeStatsToViewModels(rows);
    expect(result["Idle"]).toBeUndefined();
  });

  it("returns an empty map for an empty rows array (zero-runs workflow — legitimate, not an error)", () => {
    const result = mapNodeStatsToViewModels([]);
    expect(result).toEqual({});
  });

  it("a node whose action name has no matching row simply has no entry (caller degrades to hidden)", () => {
    const rows: INodeStatsRow[] = [
      {
        action_name: "Fetch user",
        branch: null,
        runs: 3,
        p95_ms: 200,
        ok_ratio: 1,
      },
    ];
    const result = mapNodeStatsToViewModels(rows);
    expect(result["Some other node"]).toBeUndefined();
  });
});
