import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialogRef } from "@angular/material/dialog";
import { of } from "rxjs";
import { vi } from "vitest";
import { SkillPickerDialogComponent } from "./skill-picker-dialog.component";
import { SkillsService, type ISkill } from "../../../../core/services/skills.service";

const mockSkills: ISkill[] = [
  {
    id: "skill-1",
    name: "Web Search",
    description: "Search the web for information",
    system_prompt: "You can search the web",
    icon: "search",
    color: "#42A5F5",
    trigger_commands: [],
    is_active: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "skill-2",
    name: "Calculator",
    description: "Perform mathematical calculations",
    system_prompt: "You can calculate things",
    icon: "calculate",
    color: "#66BB6A",
    trigger_commands: [],
    is_active: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
];

describe("SkillPickerDialogComponent", () => {
  let fixture: ComponentFixture<SkillPickerDialogComponent>;
  let component: SkillPickerDialogComponent;
  let mockDialogRef: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockDialogRef = { close: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SkillPickerDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        {
          provide: SkillsService,
          useValue: {
            list: () => of({ skills: mockSkills, total: mockSkills.length }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SkillPickerDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe("getSelectedSkills", () => {
    // T1: returns { id, name }[] with correct data when skills are selected
    it("returns { id, name }[] with correct data when skills are selected (BUG-1)", () => {
      component.toggleSkill("skill-1");
      component.toggleSkill("skill-2");
      fixture.detectChanges();

      const result = component.getSelectedSkills();

      expect(result).toEqual([
        { id: "skill-1", name: "Web Search" },
        { id: "skill-2", name: "Calculator" },
      ]);
    });

    // T2: returns empty array when nothing selected
    it("returns empty array when nothing selected (BUG-1)", () => {
      const result = component.getSelectedSkills();
      expect(result).toEqual([]);
    });
  });

  describe("toggleSkill", () => {
    // T3: adds/removes from selection set correctly
    it("adds and removes skills from selection set (BUG-1)", () => {
      expect(component.selected().size).toBe(0);

      component.toggleSkill("skill-1");
      expect(component.selected().has("skill-1")).toBe(true);
      expect(component.selected().size).toBe(1);

      component.toggleSkill("skill-2");
      expect(component.selected().has("skill-2")).toBe(true);
      expect(component.selected().size).toBe(2);

      component.toggleSkill("skill-1");
      expect(component.selected().has("skill-1")).toBe(false);
      expect(component.selected().size).toBe(1);
    });
  });

  describe("dialog close on confirm", () => {
    // T4: [mat-dialog-close] emits { id, name }[] on confirm
    it("passes { id, name }[] via [mat-dialog-close] on confirm (BUG-1)", () => {
      component.toggleSkill("skill-1");
      fixture.detectChanges();

      const buttons = fixture.nativeElement.querySelectorAll("button");
      const confirmButton = Array.from(buttons).find(
        (btn) => (btn as HTMLElement).textContent?.includes("Add Selected"),
      ) as HTMLButtonElement | undefined;

      expect(confirmButton).toBeDefined();
      expect(confirmButton!.disabled).toBe(false);
      confirmButton!.click();

      expect(mockDialogRef.close).toHaveBeenCalledWith([
        { id: "skill-1", name: "Web Search" },
      ]);
    });
  });
});
