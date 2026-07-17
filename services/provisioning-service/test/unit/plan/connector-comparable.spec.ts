import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { Connector } from "@yoizen/shared";
import {
  type AdapterDto,
  connectorComparable,
} from "../../../src/modules/plan/lib/comparable-fields";

// manual-loops/provisioning-manifest-gaps-2.md T07 batch B — connector `tags`
// join the comparable projection via the declared-gate idiom (only compared
// when the manifest declares them), so a connector that never declares tags
// does not diff forever against a live row whose `tags` default to `[]`.

describe("connectorComparable — tags (T07 batch B)", () => {
  const manifestConnector = (tags?: string[]): Connector => ({
    name: "sample-openai-llm",
    type: "llm",
    config: { baseUrl: "https://api.openai.com/v1" },
    ...(tags !== undefined ? { tags } : {}),
  });

  const liveAdapter = (tags?: string[]): AdapterDto => ({
    id: "b4df2eb6",
    name: "sample-openai-llm",
    context: "external",
    endpoints: [],
    ...(tags !== undefined ? { tags } : {}),
  });

  it("projects sorted tags on BOTH sides when the manifest declares them", () => {
    const desired = connectorComparable.fromManifest(
      manifestConnector(["llm", "aaa"])
    );
    const live = connectorComparable.fromLive(liveAdapter(["aaa", "llm"]), {
      tags: ["llm", "aaa"],
    } as Connector);

    expect(desired.tags).toEqual(["aaa", "llm"]);
    expect(live.tags).toEqual(["aaa", "llm"]);
    // Same key set on both sides (idempotency invariant).
    expect(Object.keys(desired).sort()).toEqual(Object.keys(live).sort());
  });

  it("omits tags from BOTH sides when the manifest does NOT declare them (no forever-diff)", () => {
    const desired = connectorComparable.fromManifest(manifestConnector());
    // Even if the live row carries tags, `fromLive` must NOT project them when
    // the manifest did not declare `tags` (declared-gate) — otherwise a
    // connector never declaring tags would diff forever against a live `[]`.
    const live = connectorComparable.fromLive(
      liveAdapter(["some-live-tag"]),
      manifestConnector()
    );

    expect(desired).not.toHaveProperty("tags");
    expect(live).not.toHaveProperty("tags");
  });

  it("the REPAIR scenario diffs: manifest declares ['llm'] but the live connector was created WITHOUT tags", () => {
    // The exact live nuance from the batch-B live gate: `sample-openai-llm`
    // (b4df2eb6) already exists with no tags; the manifest now declares
    // ['llm'] — the projections must differ so the planner produces an
    // `update` verdict and the writer's PATCH repairs the live connector.
    const desired = connectorComparable.fromManifest(
      manifestConnector(["llm"])
    );
    const live = connectorComparable.fromLive(
      liveAdapter([]),
      manifestConnector(["llm"])
    );

    expect(desired.tags).toEqual(["llm"]);
    expect(live.tags).toEqual([]);
    expect(desired).not.toEqual(live);
  });

  it("a converged connector (live tags already ['llm']) is a noop — same projection both sides", () => {
    const desired = connectorComparable.fromManifest(
      manifestConnector(["llm"])
    );
    const live = connectorComparable.fromLive(
      liveAdapter(["llm"]),
      manifestConnector(["llm"])
    );

    expect(desired).toEqual(live);
  });
});
