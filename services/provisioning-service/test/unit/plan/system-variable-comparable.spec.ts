import "../../setup-env";
import { describe, expect, it } from "bun:test";
import {
  type SystemVariableDto,
  systemVariableComparable,
} from "../../../src/modules/plan/lib/comparable-fields";

// T04 (manual-loops/provisioning-manifest-gaps.md, gap 4) — LIVE-side
// secret-leak defense. `findByName` matches by NAME ONLY, so a live
// `type: "secret"` variable (created out-of-band via admin UI/SDK) can be
// projected by `fromLive` even though the manifest schema forbids declaring
// one. `fromLive` MUST redact — never read a secret variable's plaintext
// `value` into the projection, or it would echo into `FieldDiff.current` in
// plan output.

const PLAINTEXT_SECRET = "live-secret-value-DO-NOT-LEAK";

describe("systemVariableComparable.fromLive — secret redaction", () => {
  it("omits `value` entirely for a live type:'secret' variable (never a value-derived sentinel)", () => {
    const live: SystemVariableDto = {
      id: "sysvar-secret-1",
      name: "api-key",
      type: "secret",
      value: PLAINTEXT_SECRET,
    };

    const projection = systemVariableComparable.fromLive(live);

    expect(projection).toEqual({ type: "secret" });
    expect(Object.keys(projection)).not.toContain("value");
    expect(JSON.stringify(projection)).not.toContain(PLAINTEXT_SECRET);
  });

  it("projects both `type` and `value` for a non-secret live variable (comparable config)", () => {
    const live: SystemVariableDto = {
      id: "sysvar-1",
      name: "escalation-threshold",
      type: "number",
      value: 5,
    };

    expect(systemVariableComparable.fromLive(live)).toEqual({
      type: "number",
      value: 5,
    });
  });
});
