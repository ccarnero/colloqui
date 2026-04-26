import { ComponentFixture, TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import {
  type IUsageRangeSelection,
  RangeSelectorComponent,
} from "./range-selector.component";

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll("button")).find(
    (el) => el.textContent?.trim() === text,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

describe("RangeSelectorComponent", () => {
  let fixture: ComponentFixture<RangeSelectorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RangeSelectorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RangeSelectorComponent);
    fixture.detectChanges();
  });

  it("renders supported presets without 1h", () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).not.toContain("1h");
    expect(text).toContain("6h");
    expect(text).toContain("24h");
    expect(text).toContain("7d");
    expect(text).toContain("30d");
    expect(text).toContain("Custom");
  });

  it("emits a preset selection", () => {
    const emitted = vi.fn<(value: IUsageRangeSelection) => void>();
    fixture.componentInstance.valueChange.subscribe(emitted);

    buttonByText(fixture.nativeElement as HTMLElement, "6h").click();

    expect(emitted).toHaveBeenCalledWith({ mode: "preset", preset: "6h" });
  });

  it("emits custom selection only when both dates are applied", () => {
    const emitted = vi.fn<(value: IUsageRangeSelection) => void>();
    fixture.componentInstance.valueChange.subscribe(emitted);

    buttonByText(fixture.nativeElement as HTMLElement, "Custom").click();
    fixture.detectChanges();
    expect(emitted).not.toHaveBeenCalled();

    const inputs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("input"),
    );
    expect(inputs).toHaveLength(2);

    inputs[0]!.value = "2026-04-24T10:00";
    inputs[0]!.dispatchEvent(new Event("input"));
    inputs[1]!.value = "2026-04-24T11:00";
    inputs[1]!.dispatchEvent(new Event("input"));
    fixture.detectChanges();

    buttonByText(fixture.nativeElement as HTMLElement, "Apply").click();

    expect(emitted).toHaveBeenCalledWith({
      mode: "custom",
      from: new Date("2026-04-24T10:00").toISOString(),
      to: new Date("2026-04-24T11:00").toISOString(),
    });
  });
});
