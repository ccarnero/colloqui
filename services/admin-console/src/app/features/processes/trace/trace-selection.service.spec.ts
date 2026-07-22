import { describe, expect, it, vi } from "vitest";
import { TraceSelectionService } from "./trace-selection.service";

describe("TraceSelectionService", () => {
  it("starts with no selection", () => {
    const service = new TraceSelectionService();

    expect(service.selectedEventId()).toBeNull();
    expect(service.sourceView()).toBeNull();
  });

  it("select() sets the event id and the source view together", () => {
    const service = new TraceSelectionService();

    service.select("evt-1", "waterfall");

    expect(service.selectedEventId()).toBe("evt-1");
    expect(service.sourceView()).toBe("waterfall");
  });

  it("a second select() from a different view overwrites both the id and the source", () => {
    const service = new TraceSelectionService();

    service.select("evt-1", "waterfall");
    service.select("evt-2", "causal");

    expect(service.selectedEventId()).toBe("evt-2");
    expect(service.sourceView()).toBe("causal");
  });

  it("clear() resets both signals to null", () => {
    const service = new TraceSelectionService();
    service.select("evt-1", "run");

    service.clear();

    expect(service.selectedEventId()).toBeNull();
    expect(service.sourceView()).toBeNull();
  });

  it("logs a verbose debug message on select()", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const service = new TraceSelectionService();

    service.select("evt-1", "legacy");

    expect(debugSpy).toHaveBeenCalledWith(
      "[TraceSelectionService] select",
      expect.objectContaining({ eventId: "evt-1", sourceView: "legacy" })
    );
    debugSpy.mockRestore();
  });

  it("logs a verbose debug message on clear()", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const service = new TraceSelectionService();
    service.select("evt-1", "waterfall");
    debugSpy.mockClear();

    service.clear();

    expect(debugSpy).toHaveBeenCalledWith(
      "[TraceSelectionService] clear",
      expect.objectContaining({
        previousEventId: "evt-1",
        previousSourceView: "waterfall",
      })
    );
    debugSpy.mockRestore();
  });
});
