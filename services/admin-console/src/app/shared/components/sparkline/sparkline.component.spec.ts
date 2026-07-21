import { ComponentFixture, TestBed } from "@angular/core/testing";
import { SparklineComponent } from "./sparkline.component";

describe("SparklineComponent", () => {
  let fixture: ComponentFixture<SparklineComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SparklineComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SparklineComponent);
    fixture.componentRef.setInput("data", [1, 2, 3, 2, 4]);
    fixture.componentRef.setInput("color", "#4f7ef8");
    fixture.detectChanges();
  });

  it("renders svg sparkline", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("svg.sparkline")).toBeTruthy();
  });

  it("uses the accent token as the default color", () => {
    const fresh = TestBed.createComponent(SparklineComponent);
    fresh.componentRef.setInput("data", [1, 2, 3]);
    fresh.detectChanges();
    const polyline = fresh.nativeElement.querySelector("polyline");
    expect(polyline?.getAttribute("stroke")).toBe("var(--rd-accent)");
  });

  it("handles empty data without throwing and logs instead of failing silently", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const empty = TestBed.createComponent(SparklineComponent);
    empty.componentRef.setInput("data", []);
    expect(() => empty.detectChanges()).not.toThrow();
    const polyline = empty.nativeElement.querySelector("polyline");
    expect(polyline?.getAttribute("points")).toBe("");
    expect(debugSpy).toHaveBeenCalled();
  });

  it("handles a single data point without throwing", () => {
    const single = TestBed.createComponent(SparklineComponent);
    single.componentRef.setInput("data", [42]);
    expect(() => single.detectChanges()).not.toThrow();
    const polyline = single.nativeElement.querySelector("polyline");
    expect(polyline?.getAttribute("points")).toBe("");
  });
});
