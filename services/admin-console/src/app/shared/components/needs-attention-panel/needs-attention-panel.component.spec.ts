import { ComponentFixture, TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import {
  IAttentionIssue,
  NeedsAttentionPanelComponent,
} from "./needs-attention-panel.component";

const issues: IAttentionIssue[] = [
  {
    id: "1",
    message: "token vencido hace 2 h",
    severity: "critical",
    action: { label: "Reconectar" },
  },
  {
    id: "2",
    message: "spike de error 131047",
    severity: "warning",
  },
];

describe("NeedsAttentionPanelComponent", () => {
  let fixture: ComponentFixture<NeedsAttentionPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NeedsAttentionPanelComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(NeedsAttentionPanelComponent);
  });

  it("renders one row per issue with its severity dot", () => {
    fixture.componentRef.setInput("issues", issues);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll(".issue-row");
    expect(rows.length).toBe(2);
    expect(
      rows[0]
        .querySelector(".issue-dot")
        ?.classList.contains("issue-dot--critical")
    ).toBe(true);
    expect(
      rows[1]
        .querySelector(".issue-dot")
        ?.classList.contains("issue-dot--warning")
    ).toBe(true);
  });

  it("renders the action link when present and emits actionClick on click", () => {
    fixture.componentRef.setInput("issues", issues);
    fixture.detectChanges();

    const emitted: IAttentionIssue[] = [];
    fixture.componentInstance.actionClick.subscribe((issue) =>
      emitted.push(issue)
    );

    const el = fixture.nativeElement as HTMLElement;
    const actionLink = el.querySelector(".issue-action") as HTMLElement;
    expect(actionLink.textContent).toContain("Reconectar");
    actionLink.click();

    expect(emitted).toEqual([issues[0]]);
  });

  it("renders an empty state and logs when there are no issues (does not fail silently)", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    fixture.componentRef.setInput("issues", []);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".panel-empty")).toBeTruthy();
    expect(el.querySelectorAll(".issue-row").length).toBe(0);
    expect(debugSpy).toHaveBeenCalled();
  });
});
