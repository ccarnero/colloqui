import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from "@angular/material/dialog";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { SkillFormDialogComponent, ISkillFormResult } from "./skill-form-dialog.component";

describe("SkillFormDialogComponent", () => {
  let component: SkillFormDialogComponent;
  let fixture: ComponentFixture<SkillFormDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SkillFormDialogComponent, MatDialogModule, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: null },
        { provide: MatDialogRef, useValue: { close: () => {} } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SkillFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });

  it("getResult() includes when_to_use field", () => {
    component.form.when_to_use = "Use when customer asks about pricing";
    const result = component.getResult();
    expect(result.when_to_use).toBe("Use when customer asks about pricing");
  });

  it("getResult() includes priority field", () => {
    component.form.priority = 50;
    const result = component.getResult();
    expect(result.priority).toBe(50);
  });

  it("getResult() includes mode field", () => {
    component.form.mode = "router";
    const result = component.getResult();
    expect(result.mode).toBe("router");
  });

  it("getResult() parses allowed_tools from comma-separated text", () => {
    component.allowedToolsText = "tool1, tool2, tool3";
    const result = component.getResult();
    expect(result.allowed_tools).toEqual(["tool1", "tool2", "tool3"]);
  });

  it("getResult() returns empty allowed_tools when text is empty", () => {
    component.allowedToolsText = "";
    const result = component.getResult();
    expect(result.allowed_tools).toEqual([]);
  });

  it("initializes form from existing skill data", () => {
    const skillData = {
      id: "123",
      name: "Test",
      description: "Desc",
      system_prompt: "Prompt",
      icon: "smart_toy",
      color: "#ff0000",
      trigger_commands: ["/test"],
      when_to_use: "Use when testing",
      priority: 100,
      allowed_tools: ["tool_a", "tool_b"],
      mode: "router",
      is_active: true,
      files: [],
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SkillFormDialogComponent, MatDialogModule, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: skillData },
        { provide: MatDialogRef, useValue: { close: () => {} } },
      ],
    });
    const editFixture = TestBed.createComponent(SkillFormDialogComponent);
    const editComponent = editFixture.componentInstance;
    editFixture.detectChanges();

    expect(editComponent.form.when_to_use).toBe("Use when testing");
    expect(editComponent.form.priority).toBe(100);
    expect(editComponent.form.mode).toBe("router");
    expect(editComponent.allowedToolsText).toBe("tool_a, tool_b");
  });
});
