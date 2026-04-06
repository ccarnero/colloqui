import { ComponentFixture, TestBed } from "@angular/core/testing";

import { YoizenclawTopBarComponent } from "./yoizenclaw-top-bar.component";

describe("YoizenclawTopBarComponent", () => {
  let fixture: ComponentFixture<YoizenclawTopBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [YoizenclawTopBarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(YoizenclawTopBarComponent);
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
    expect(el.textContent).toContain("YoizenClaw Agents");
    expect(el.textContent).toContain("Create Agent");
  });
});
