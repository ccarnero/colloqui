import { ComponentFixture, TestBed } from "@angular/core/testing";
import { YoizenclawExistingAgentsPanelComponent } from "./existing-agents-panel.component";

describe("YoizenclawExistingAgentsPanelComponent", () => {
  let fixture: ComponentFixture<YoizenclawExistingAgentsPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [YoizenclawExistingAgentsPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(YoizenclawExistingAgentsPanelComponent);
    fixture.componentRef.setInput("agents", []);
    fixture.componentRef.setInput("loading", false);
    fixture.componentRef.setInput("editingAgentId", null);
    fixture.componentRef.setInput("publishingId", null);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
