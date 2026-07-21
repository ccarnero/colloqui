import { ComponentFixture, TestBed } from "@angular/core/testing";
import { KpiCardComponent } from "./kpi-card.component";

describe("KpiCardComponent", () => {
  let fixture: ComponentFixture<KpiCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KpiCardComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(KpiCardComponent);
  });

  function setInputs(overrides: Partial<Record<string, unknown>> = {}): void {
    fixture.componentRef.setInput("label", "API Calls Today");
    fixture.componentRef.setInput("value", "48,214");
    for (const [key, value] of Object.entries(overrides)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
  }

  it("renders label and value", () => {
    setInputs();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".kpi-label")?.textContent).toBe("API Calls Today");
    expect(el.querySelector(".kpi-value")?.textContent).toBe("48,214");
  });

  it("renders sub text without a trend", () => {
    setInputs({ sub: "last 15 min" });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".kpi-sub-text")?.textContent).toBe("last 15 min");
    expect(el.querySelector(".trend-flat")).toBeNull();
  });

  it("renders an up-good trend with the good color class", () => {
    setInputs({ trend: "up", trendLabel: "12.4% vs ayer" });
    const el = fixture.nativeElement as HTMLElement;
    const trendEl = el.querySelector(".trend-up-good");
    expect(trendEl?.textContent?.trim()).toBe("↑ 12.4% vs ayer");
  });

  it("flips trend semantics when trendIsGood is false", () => {
    setInputs({
      trend: "up",
      trendLabel: "0.4% error rate",
      trendIsGood: false,
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".trend-up-bad")).toBeTruthy();
  });

  it("does not render a sparkline when sparklineData is absent", () => {
    setInputs();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("app-sparkline")).toBeNull();
  });

  it("renders a sparkline slot when sparklineData has values", () => {
    setInputs({ sparklineData: [1, 4, 2, 6, 3] });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("app-sparkline")).toBeTruthy();
  });

  it("handles empty sparklineData without rendering the sparkline (logs instead of failing silently)", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    setInputs({ sparklineData: [] });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("app-sparkline")).toBeNull();
    expect(debugSpy).toHaveBeenCalled();
  });
});
