import { classifyNodeRunStatus } from "../classify-node-run-status";

describe("classifyNodeRunStatus", () => {
  it("returns 'ok' for a high ok_ratio", () => {
    expect(classifyNodeRunStatus(1)).toBe("ok");
    expect(classifyNodeRunStatus(0.98)).toBe("ok");
  });

  it("returns 'warning' for a degraded but not critical ok_ratio", () => {
    expect(classifyNodeRunStatus(0.9)).toBe("warning");
    expect(classifyNodeRunStatus(0.8)).toBe("warning");
  });

  it("returns 'error' for a low ok_ratio", () => {
    expect(classifyNodeRunStatus(0.5)).toBe("error");
    expect(classifyNodeRunStatus(0)).toBe("error");
  });

  it("returns 'warning' (not a fabricated ok) when ok_ratio is null", () => {
    expect(classifyNodeRunStatus(null)).toBe("warning");
  });
});
