import type { INodeStatsBranchRow } from "../map-node-stats-to-view-models";
import { resolveBranchEvidence } from "../resolve-branch-evidence";

describe("resolveBranchEvidence", () => {
  const rows: INodeStatsBranchRow[] = [
    { actionName: "buildEscalationReply", branch: "VIP escalation", runs: 11 },
    { actionName: "replyStandard", branch: "default", runs: 12 },
  ];

  it("computes matched/total/percent against the conditional node's own run total (mock's 11/23 . 48%)", () => {
    const result = resolveBranchEvidence(rows, 23, {
      branchLabel: "VIP escalation",
      targetActionName: "buildEscalationReply",
    });
    expect(result).toEqual({ matched: 11, total: 23, percent: 48 });
  });

  it("computes the default branch's own evidence against the same node total (mock's 12/23 . 52%)", () => {
    const result = resolveBranchEvidence(rows, 23, {
      branchLabel: "default",
      targetActionName: "replyStandard",
    });
    expect(result).toEqual({ matched: 12, total: 23, percent: 52 });
  });

  it("returns null when this branch has no matching row (never ran / no data)", () => {
    const result = resolveBranchEvidence(rows, 23, {
      branchLabel: "neverTaken",
      targetActionName: "someAction",
    });
    expect(result).toBeNull();
  });

  it("returns null when the node's own run total is null (no data for the conditional itself)", () => {
    const result = resolveBranchEvidence(rows, null, {
      branchLabel: "VIP escalation",
      targetActionName: "buildEscalationReply",
    });
    expect(result).toBeNull();
  });

  it("returns null when the node's own run total is zero (never zeros-as-facts)", () => {
    const result = resolveBranchEvidence(rows, 0, {
      branchLabel: "VIP escalation",
      targetActionName: "buildEscalationReply",
    });
    expect(result).toBeNull();
  });

  it("rename-staleness regression: renaming a SIBLING branch does not change this branch's percentage, because the denominator is the node's own row, not a sum of sibling rows keyed by current labels", () => {
    // Before rename: "VIP escalation" had 11 runs recorded under that
    // label. After a user renames it to "Priority route", the historical
    // rows still say branch: "VIP escalation" (rename-proof by design —
    // the renamed branch itself simply stops matching and hides, which is
    // acceptable). What must NOT happen is the default branch's total
    // silently dropping those 11 runs and inflating its own percentage.
    const nodeTotal = 23; // the conditional's own row: unaffected by the rename.
    const defaultResult = resolveBranchEvidence(rows, nodeTotal, {
      branchLabel: "default",
      targetActionName: "replyStandard",
    });
    expect(defaultResult).toEqual({ matched: 12, total: 23, percent: 52 });

    // The renamed branch itself ("Priority route") has no historical row
    // yet and correctly hides rather than fabricating a number.
    const renamedResult = resolveBranchEvidence(rows, nodeTotal, {
      branchLabel: "Priority route",
      targetActionName: "buildEscalationReply",
    });
    expect(renamedResult).toBeNull();
  });
});
