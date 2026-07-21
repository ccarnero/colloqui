import { ComponentFixture, TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import { StatusBadgeComponent } from "./status-badge.component";

describe("StatusBadgeComponent", () => {
  let fixture: ComponentFixture<StatusBadgeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusBadgeComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(StatusBadgeComponent);
    fixture.componentRef.setInput("status", "Active");
    fixture.componentRef.setInput("color", "green");
    fixture.detectChanges();
  });

  it("renders status text", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent?.trim()).toBe("Active");
  });

  describe("health-dot variant", () => {
    function createDot(
      status: string,
      health?: string
    ): ComponentFixture<StatusBadgeComponent> {
      const f = TestBed.createComponent(StatusBadgeComponent);
      f.componentRef.setInput("status", status);
      f.componentRef.setInput("variant", "dot");
      if (health !== undefined) {
        f.componentRef.setInput("health", health);
      }
      f.detectChanges();
      return f;
    }

    it("renders an ok dot for explicit health", () => {
      const f = createDot("Connected", "ok");
      const dot = (f.nativeElement as HTMLElement).querySelector(".health-dot");
      expect(dot?.classList.contains("health-dot--ok")).toBe(true);
      expect(
        (f.nativeElement as HTMLElement).querySelector(".health-label")
          ?.textContent
      ).toBe("Connected");
    });

    it("renders a warn dot for explicit health", () => {
      const f = createDot("Degraded", "warn");
      const dot = (f.nativeElement as HTMLElement).querySelector(".health-dot");
      expect(dot?.classList.contains("health-dot--warn")).toBe(true);
    });

    it("renders an error dot for explicit health", () => {
      const f = createDot("Down", "error");
      const dot = (f.nativeElement as HTMLElement).querySelector(".health-dot");
      expect(dot?.classList.contains("health-dot--error")).toBe(true);
    });

    it("renders an idle dot for explicit health", () => {
      const f = createDot("Unknown", "idle");
      const dot = (f.nativeElement as HTMLElement).querySelector(".health-dot");
      expect(dot?.classList.contains("health-dot--idle")).toBe(true);
    });

    it("derives ok health from status text when health is not provided", () => {
      const f = createDot("connected");
      const dot = (f.nativeElement as HTMLElement).querySelector(".health-dot");
      expect(dot?.classList.contains("health-dot--ok")).toBe(true);
    });

    it("handles empty status by defaulting to idle and logging instead of failing silently", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      const f = createDot("");
      const dot = (f.nativeElement as HTMLElement).querySelector(".health-dot");
      expect(dot?.classList.contains("health-dot--idle")).toBe(true);
      expect(
        (f.nativeElement as HTMLElement).querySelector(".health-label")
      ).toBeNull();
      expect(debugSpy).toHaveBeenCalled();
    });
  });

  it("keeps the default badge variant unaffected by the health input existing on the type", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".health")).toBeNull();
    expect(el.querySelector("span.badge-green")).toBeTruthy();
  });
});
