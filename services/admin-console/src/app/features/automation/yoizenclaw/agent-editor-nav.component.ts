import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { MatTooltipModule } from "@angular/material/tooltip";
import type {
  IAgentToolDraft,
  IYoizenclawSubagentDraft,
  IYoizenclawTemplate,
} from "../../../core/models/yoizenclaw.model";
import {
  type IAgentEditorSelection,
  SELECTION_GENERAL,
  SELECTION_INSTRUCTION_MENTIONS,
  SELECTION_INSTRUCTION_PROMPT,
  SELECTION_INSTRUCTION_RULES,
  SELECTION_INSTRUCTION_SOUL,
  isInstructionSelection,
  isSameSelection,
  selectSkill,
  selectTool,
} from "./agent-editor.types";

/**
 * Left palette for the agent builder.
 *
 * Visual idiom mirrors the workflow builder palette (palette-group / palette-item)
 * but functionally it's an outline tree: clicking an item changes which focused
 * editor renders in the center.
 *
 * Adds three things on top of the WF palette:
 *  - A collapse toggle at the top to shrink the rail to icon-only mode.
 *  - Expandable parent groups (Instructions, Skills, Tools).
 *  - A Templates section that applies a template on click (parent confirms).
 */
@Component({
  selector: "app-yoizenclaw-editor-nav",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    <nav class="palette" [class.collapsed]="collapsed()" aria-label="Agent builder">
      <header class="palette-toolbar">
        <button
          type="button"
          class="palette-collapse-btn"
          (click)="toggleCollapsed.emit()"
          [matTooltip]="collapsed() ? 'Expand palette' : 'Collapse palette'"
          matTooltipPosition="right"
        >
          <mat-icon>{{ collapsed() ? "chevron_right" : "chevron_left" }}</mat-icon>
        </button>
      </header>

      <!-- CONFIGURATION group -->
      <section class="palette-group">
        <div class="palette-group-label">Configuration</div>

        <button
          type="button"
          class="palette-item"
          [class.active]="isActive(general)"
          (click)="select.emit(general)"
          [matTooltip]="collapsed() ? 'General' : ''"
          matTooltipPosition="right"
        >
          <mat-icon class="row-icon">tune</mat-icon>
          <span class="row-label">General</span>
        </button>

        <button
          type="button"
          class="palette-item parent"
          [class.active]="instructionActive()"
          (click)="onInstructionsClick()"
          [matTooltip]="collapsed() ? 'Instructions' : ''"
          matTooltipPosition="right"
        >
          <mat-icon class="row-icon">menu_book</mat-icon>
          <span class="row-label">Instructions</span>
          <mat-icon class="chevron">{{
            instructionsExpanded() ? "expand_more" : "chevron_right"
          }}</mat-icon>
        </button>
        @if (!collapsed() && instructionsExpanded()) {
          <button
            type="button"
            class="palette-item child"
            [class.active]="isActive(instructionPrompt)"
            (click)="select.emit(instructionPrompt)"
          >
            <span class="row-bullet">·</span>
            <span class="row-label">System Prompt</span>
          </button>
          <button
            type="button"
            class="palette-item child"
            [class.active]="isActive(instructionRules)"
            (click)="select.emit(instructionRules)"
          >
            <span class="row-bullet">·</span>
            <span class="row-label">Rules</span>
          </button>
          <button
            type="button"
            class="palette-item child"
            [class.active]="isActive(instructionSoul)"
            (click)="select.emit(instructionSoul)"
          >
            <span class="row-bullet">·</span>
            <span class="row-label">Soul</span>
          </button>
          <button
            type="button"
            class="palette-item child"
            [class.active]="isActive(instructionMentions)"
            (click)="select.emit(instructionMentions)"
          >
            <span class="row-bullet">·</span>
            <span class="row-label">Detected References</span>
          </button>
        }

        <div class="palette-parent-row">
          <button
            type="button"
            class="palette-item parent flex-grow"
            (click)="toggleSkillsExpanded()"
            [matTooltip]="collapsed() ? 'Skills' : ''"
            matTooltipPosition="right"
          >
            <mat-icon class="row-icon">extension</mat-icon>
            <span class="row-label">Skills</span>
            <span class="badge">{{ skills().length }}</span>
            <mat-icon class="chevron">{{
              skillsExpanded() ? "expand_more" : "chevron_right"
            }}</mat-icon>
          </button>
          @if (!collapsed()) {
            <button
              type="button"
              class="add-btn"
              aria-label="Add skill"
              (click)="addSkill.emit()"
            >
              <mat-icon>add</mat-icon>
            </button>
          }
        </div>

        @if (!collapsed() && skillsExpanded()) {
          @for (skill of skills(); track $index) {
            <button
              type="button"
              class="palette-item child"
              [class.active]="isActive({ kind: 'skill', index: $index })"
              (click)="select.emit(toSkill($index))"
            >
              <span class="row-bullet">·</span>
              <span class="row-label">
                {{ skill.name || "Untitled skill" }}
              </span>
              <button
                type="button"
                class="remove-btn"
                aria-label="Remove skill"
                (click)="onRemoveSkill($event, $index)"
              >
                <mat-icon>close</mat-icon>
              </button>
            </button>
          }

          @if (skills().length === 0) {
            <div class="empty-row">No skills yet</div>
          }
        }

        <div class="palette-parent-row">
          <button
            type="button"
            class="palette-item parent flex-grow"
            (click)="toggleToolsExpanded()"
            [matTooltip]="collapsed() ? 'Tools' : ''"
            matTooltipPosition="right"
          >
            <mat-icon class="row-icon">build</mat-icon>
            <span class="row-label">Tools</span>
            <span class="badge">{{ tools().length }}</span>
            <mat-icon class="chevron">{{
              toolsExpanded() ? "expand_more" : "chevron_right"
            }}</mat-icon>
          </button>
          @if (!collapsed()) {
            <button
              type="button"
              class="add-btn"
              aria-label="Add tool"
              (click)="addTool.emit()"
            >
              <mat-icon>add</mat-icon>
            </button>
          }
        </div>

        @if (!collapsed() && toolsExpanded()) {
          @for (tool of tools(); track $index) {
            <button
              type="button"
              class="palette-item child"
              [class.active]="isActive({ kind: 'tool', index: $index })"
              (click)="select.emit(toTool($index))"
            >
              <span class="row-bullet">·</span>
              <span class="row-label">
                {{ tool.name || "Untitled tool" }}
              </span>
              <button
                type="button"
                class="remove-btn"
                aria-label="Remove tool"
                (click)="onRemoveTool($event, $index)"
              >
                <mat-icon>close</mat-icon>
              </button>
            </button>
          }

          @if (tools().length === 0) {
            <div class="empty-row">No tools yet</div>
          }
        }
      </section>

      @if (!collapsed() && templates().length > 0) {
        <section class="palette-group">
          <div class="palette-group-label">Templates</div>
          @for (tpl of templates(); track tpl.id) {
            <button
              type="button"
              class="palette-item child template-item"
              [class.active]="tpl.id === selectedTemplateId()"
              (click)="applyTemplate.emit(tpl.id)"
            >
              <span class="row-bullet">·</span>
              <span class="row-label">{{ tpl.label }}</span>
              @if (tpl.id === selectedTemplateId()) {
                <mat-icon class="check">check</mat-icon>
              }
            </button>
          }
        </section>
      }
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }

    .palette {
      display: flex;
      flex-direction: column;
      width: 230px;
      background: var(--bg-sidebar, var(--bg2));
      border: 1px solid var(--border-subtle, var(--border));
      border-radius: 12px;
      overflow: hidden;
      transition: width 0.18s ease;
      user-select: none;
    }

    .palette.collapsed {
      width: 52px;
    }

    .palette-toolbar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 6px;
      border-bottom: 1px solid var(--border-subtle, var(--border));
    }

    .palette.collapsed .palette-toolbar {
      justify-content: center;
    }

    .palette-collapse-btn {
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text3);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .palette-collapse-btn:hover {
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-primary);
    }

    .palette-collapse-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .palette-group {
      display: flex;
      flex-direction: column;
      padding: 10px 8px;
      gap: 2px;
      border-bottom: 1px solid var(--border-subtle, var(--border));
    }

    .palette-group:last-child {
      border-bottom: 0;
    }

    .palette-group-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text3);
      padding: 4px 10px 6px;
    }

    .palette.collapsed .palette-group-label {
      display: none;
    }

    .palette-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: var(--text-secondary);
      font-size: 13px;
      text-align: left;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
      width: 100%;
      min-width: 0;
    }

    .palette-item:hover {
      background: var(--hover-accent, rgba(255, 255, 255, 0.04));
      color: var(--text-primary);
    }

    .palette-item.active {
      background: var(--accent-dim, rgba(99, 102, 241, 0.12));
      color: var(--text-primary);
      border-color: var(--border-subtle, var(--border));
    }

    .palette-item.child {
      padding: 5px 10px 5px 28px;
      font-size: 12.5px;
    }

    .palette.collapsed .palette-item.child,
    .palette.collapsed .empty-row,
    .palette.collapsed .palette-parent-row .add-btn {
      display: none;
    }

    .palette.collapsed .palette-item {
      justify-content: center;
      padding: 7px 0;
    }

    .palette.collapsed .palette-item .row-label,
    .palette.collapsed .palette-item .badge,
    .palette.collapsed .palette-item .chevron {
      display: none;
    }

    .palette-parent-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .palette-item.flex-grow {
      flex: 1;
    }

    .row-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--accent, var(--text3));
      flex-shrink: 0;
    }

    .row-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row-bullet {
      color: var(--text3);
      font-size: 14px;
      width: 8px;
      text-align: center;
    }

    .chevron {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--text3);
    }

    .badge {
      font-size: 10px;
      font-weight: 600;
      color: var(--text3);
      background: var(--bg3, rgba(255, 255, 255, 0.06));
      padding: 1px 7px;
      border-radius: 999px;
    }

    .check {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--accent, var(--primary));
    }

    .add-btn,
    .remove-btn {
      width: 22px;
      height: 22px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text3);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
    }

    .add-btn {
      opacity: 0.7;
    }

    .add-btn:hover {
      opacity: 1;
      background: var(--hover-accent, rgba(255, 255, 255, 0.06));
      color: var(--text-primary);
    }

    .remove-btn {
      opacity: 0;
      transition: opacity 0.15s ease, background 0.15s ease;
    }

    .palette-item:hover .remove-btn,
    .palette-item.active .remove-btn {
      opacity: 1;
    }

    .remove-btn:hover {
      background: rgba(248, 113, 113, 0.1);
      color: #f87171;
    }

    .add-btn mat-icon,
    .remove-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .empty-row {
      padding: 4px 28px;
      font-size: 11.5px;
      color: var(--text3);
      font-style: italic;
    }

    .template-item {
      padding-left: 14px;
    }
  `,
})
export class YoizenclawAgentEditorNavComponent {
  readonly selection = input.required<IAgentEditorSelection>();
  readonly skills = input.required<IYoizenclawSubagentDraft[]>();
  readonly tools = input.required<IAgentToolDraft[]>();
  readonly templates = input<IYoizenclawTemplate[]>([]);
  readonly selectedTemplateId = input<string>("");
  readonly collapsed = input<boolean>(false);

  readonly select = output<IAgentEditorSelection>();
  readonly addSkill = output<void>();
  readonly addTool = output<void>();
  readonly removeSkill = output<number>();
  readonly removeTool = output<number>();
  readonly applyTemplate = output<string>();
  readonly toggleCollapsed = output<void>();

  protected readonly general = SELECTION_GENERAL;
  protected readonly instructionPrompt = SELECTION_INSTRUCTION_PROMPT;
  protected readonly instructionRules = SELECTION_INSTRUCTION_RULES;
  protected readonly instructionSoul = SELECTION_INSTRUCTION_SOUL;
  protected readonly instructionMentions = SELECTION_INSTRUCTION_MENTIONS;

  protected readonly toSkill = (index: number) => selectSkill(index);
  protected readonly toTool = (index: number) => selectTool(index);

  // Local UI state for parent group expansion
  protected readonly instructionsExpanded = signal(true);
  protected readonly skillsExpanded = signal(true);
  protected readonly toolsExpanded = signal(true);

  protected readonly instructionActive = computed(() =>
    isInstructionSelection(this.selection()),
  );

  protected isActive(candidate: IAgentEditorSelection): boolean {
    return isSameSelection(candidate, this.selection());
  }

  protected onInstructionsClick(): void {
    this.instructionsExpanded.update((v) => !v);
    // If closing while a child is selected, push selection up to the prompt
    // so the user keeps a focused editor visible.
    if (!this.instructionsExpanded() && isInstructionSelection(this.selection())) {
      this.select.emit(SELECTION_INSTRUCTION_PROMPT);
    }
    if (this.instructionsExpanded() && !isInstructionSelection(this.selection())) {
      this.select.emit(SELECTION_INSTRUCTION_PROMPT);
    }
  }

  protected toggleSkillsExpanded(): void {
    this.skillsExpanded.update((v) => !v);
  }

  protected toggleToolsExpanded(): void {
    this.toolsExpanded.update((v) => !v);
  }

  protected onRemoveSkill(event: MouseEvent, index: number): void {
    event.stopPropagation();
    this.removeSkill.emit(index);
  }

  protected onRemoveTool(event: MouseEvent, index: number): void {
    event.stopPropagation();
    this.removeTool.emit(index);
  }
}
