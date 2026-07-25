import { ComponentFixture, TestBed } from "@angular/core/testing";

import { AiTopBarComponent } from "./ai-top-bar.component";

describe("AiTopBarComponent", () => {
  let fixture: ComponentFixture<AiTopBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AiTopBarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AiTopBarComponent);
    fixture.componentRef.setInput("editingAgentId", null);
    fixture.componentRef.setInput("saving", false);
    fixture.componentRef.setInput("loading", false);
    fixture.componentRef.setInput("canSave", true);
    fixture.componentRef.setInput("errorMessage", "");
    fixture.componentRef.setInput("successMessage", "");
    fixture.detectChanges();
  });

  it("renders title and primary action", () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain("AI Agents");
    expect(el.textContent).toContain("Create Agent");
  });

  /**
   * Task B (agent chrome parity): when nested under AiAgentDetailComponent's
   * /configure floating chrome, this component's own page-header (with the
   * same Save/Reset/Cancel actions) would duplicate the parent's chrome —
   * hideChrome suppresses only that block, alerts still render.
   */
  it("hides its own page-header actions when hideChrome is true", () => {
    fixture.componentRef.setInput("hideChrome", true);
    fixture.componentRef.setInput("errorMessage", "Something failed");
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).not.toContain("Create Agent");
    expect(el.textContent).toContain("Something failed");
  });
});
