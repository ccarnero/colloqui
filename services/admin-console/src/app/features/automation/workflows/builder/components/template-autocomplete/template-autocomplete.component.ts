import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  signal,
  ViewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { IWorkflowNode } from "../../../domain/workflow-node.types";

export interface IVariableGroup {
  namespace: string;
  icon: string;
  variables: IVariableEntry[];
}

export interface IVariableEntry {
  path: string;
  label: string;
  description: string;
  example?: string;
}

/**
 * Textarea with template-variable autocomplete.
 *
 * When the user types `{{` a dropdown appears with available template
 * variables grouped by namespace (Request, Results, Variables, Built-in).
 * Selecting a variable inserts the full `{{path}}` expression.
 */
@Component({
  selector: "app-template-autocomplete",
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ta-wrapper" #wrapper>
      <textarea
        #textarea
        class="ta-textarea"
        [value]="value"
        (input)="onInput($event)"
        (keydown)="onKeyDown($event)"
        (blur)="onBlur()"
        [placeholder]="placeholder"
        [rows]="rows"
      ></textarea>
      @if (showDropdown()) {
        <div
          class="ta-dropdown"
          [style.top.px]="dropdownTop()"
          [style.left.px]="dropdownLeft()"
        >
          @for (group of filteredGroups(); track group.namespace) {
            <div class="ta-group">
              <div class="ta-group-header">
                <span class="ta-group-icon">{{ group.icon }}</span>
                {{ group.namespace }}
              </div>
              @for (v of group.variables; track v.path) {
                <div
                  class="ta-item"
                  [class.ta-item-active]="
                    activeIndex() === getGlobalIndex(group, v)
                  "
                  (mousedown)="selectVariable(v)"
                  (mouseenter)="
                    activeIndex.set(getGlobalIndex(group, v))
                  "
                >
                  <span class="ta-item-path">{{ v.path }}</span>
                  <span class="ta-item-desc">{{ v.description }}</span>
                </div>
              }
            </div>
          }
          @if (filteredGroups().length === 0) {
            <div class="ta-empty">No matching variables</div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .ta-wrapper {
        position: relative;
      }
      .ta-textarea {
        width: 100%;
        min-height: 60px;
        font-family: inherit;
        font-size: 13px;
        padding: 8px;
        border: 1px solid var(--border-subtle, #ccc);
        border-radius: var(--radius, 6px);
        background: var(--bg-surface, #fff);
        color: var(--text-primary, #333);
        resize: vertical;
        box-sizing: border-box;
      }
      .ta-textarea:focus {
        outline: none;
        border-color: var(--accent, #6366f1);
      }
      .ta-dropdown {
        position: absolute;
        z-index: 1000;
        min-width: 320px;
        max-height: 280px;
        overflow-y: auto;
        background: var(--bg-surface, #fff);
        border: 1px solid var(--border-subtle, #ccc);
        border-radius: var(--radius, 6px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
      .ta-group {
        padding: 4px 0;
      }
      .ta-group-header {
        padding: 6px 12px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text2, #666);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .ta-group-icon {
        font-size: 14px;
      }
      .ta-item {
        padding: 6px 12px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .ta-item:hover,
      .ta-item-active {
        background: var(--bg3, #f0f0f0);
      }
      .ta-item-path {
        font-size: 12px;
        font-family: var(--font-mono, ui-monospace, monospace);
        color: var(--text-primary, #333);
      }
      .ta-item-desc {
        font-size: 11px;
        color: var(--text3, #999);
      }
      .ta-empty {
        padding: 12px;
        text-align: center;
        font-size: 12px;
        color: var(--text3, #999);
      }
    `,
  ],
})
export class TemplateAutocompleteComponent {
  @Input() value = "";
  @Input() placeholder = "";
  @Input() rows = 3;
  @Input() workflowNodes: IWorkflowNode[] = [];
  @Input() currentNodeKey = "";
  @Output() valueChange = new EventEmitter<string>();

  @ViewChild("textarea") textareaRef!: ElementRef<HTMLTextAreaElement>;
  @ViewChild("wrapper") wrapperRef!: ElementRef<HTMLDivElement>;

  readonly showDropdown = signal(false);
  readonly activeIndex = signal(0);
  readonly dropdownTop = signal(0);
  readonly dropdownLeft = signal(0);
  readonly filteredGroups = signal<IVariableGroup[]>([]);

  private allGroups: IVariableGroup[] = [];
  private filterText = "";
  private cursorPos = 0;

  ngOnChanges(): void {
    this.buildVariableGroups();
  }

  /**
   * Builds the list of available template variables from the workflow
   * nodes. Each node (except the current one) contributes its result
   * variables. Built-in variables are always available.
   */
  private buildVariableGroups(): void {
    const groups: IVariableGroup[] = [];

    // Request variables — extracted from existing template usage across
    // all nodes to discover what request fields are in play.
    const requestVars = this.extractRequestVariables();
    if (requestVars.length > 0) {
      groups.push({
        namespace: "Request",
        icon: "\uD83D\uDCE5",
        variables: requestVars,
      });
    }

    // Results from other steps (exclude the current node being edited)
    const resultVars: IVariableEntry[] = [];
    for (const node of this.workflowNodes) {
      if (node.key === this.currentNodeKey) {
        continue;
      }
      if (!node.name) {
        continue;
      }
      resultVars.push({
        path: `results["${node.name}"].data`,
        label: `${node.name} data`,
        description: `Full output from ${node.name}`,
      });
      resultVars.push({
        path: `results["${node.name}"].data.reply`,
        label: `${node.name} reply`,
        description: `Reply text from ${node.name}`,
      });
    }
    if (resultVars.length > 0) {
      groups.push({
        namespace: "Results",
        icon: "\uD83D\uDCCA",
        variables: resultVars,
      });
    }

    // Built-in variables — always available
    groups.push({
      namespace: "Built-in",
      icon: "\u2699\uFE0F",
      variables: [
        {
          path: "request.from",
          label: "from",
          description: "Sender identifier (phone/JID)",
        },
        {
          path: "request.text",
          label: "text",
          description: "Inbound message text",
        },
        {
          path: "request.conversationId",
          label: "conversationId",
          description: "Current conversation ID",
        },
        {
          path: "request.channel",
          label: "channel",
          description: "Channel type (whatsapp, telegram…)",
        },
        {
          path: "variables.previous",
          label: "previous",
          description: "Previous step result",
        },
        {
          path: "workflow.tenant",
          label: "tenant",
          description: "Current tenant ID",
        },
        {
          path: "workflow.name",
          label: "name",
          description: "Workflow name",
        },
      ],
    });

    this.allGroups = groups;
    this.filteredGroups.set(groups);
  }

  /**
   * Scans all node configurations for `{{request.X}}` patterns to
   * discover request variables that are already in use. This gives
   * the user a discoverable list of what's available.
   */
  private extractRequestVariables(): IVariableEntry[] {
    const seen = new Set<string>();
    const vars: IVariableEntry[] = [];
    for (const node of this.workflowNodes) {
      const json = JSON.stringify(node.configuration);
      const regex = /\{\{request\.([^}]+)\}\}/g;
      let match;
      while ((match = regex.exec(json)) !== null) {
        if (!seen.has(match[1])) {
          seen.add(match[1]);
          vars.push({
            path: `request.${match[1]}`,
            label: match[1],
            description: `Input variable: ${match[1]}`,
          });
        }
      }
    }
    return vars;
  }

  onInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    const val = textarea.value;
    this.value = val;
    this.valueChange.emit(val);

    // Detect {{ trigger — show dropdown when user has typed an
    // unclosed {{ and is still typing the variable path.
    const pos = textarea.selectionStart;
    this.cursorPos = pos;
    const before = val.substring(0, pos);
    const lastOpen = before.lastIndexOf("{{");

    if (lastOpen >= 0 && !before.substring(lastOpen).includes("}}")) {
      this.filterText = before.substring(lastOpen + 2).trim();
      this.applyFilter();
      this.showDropdown.set(true);
      this.activeIndex.set(0);
      this.positionDropdown(textarea);
    } else {
      this.showDropdown.set(false);
    }
  }

  private applyFilter(): void {
    if (!this.filterText) {
      this.filteredGroups.set(this.allGroups);
      return;
    }
    const q = this.filterText.toLowerCase();
    const filtered = this.allGroups
      .map((g) => ({
        ...g,
        variables: g.variables.filter(
          (v) =>
            v.path.toLowerCase().includes(q) ||
            v.description.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.variables.length > 0);
    this.filteredGroups.set(filtered);
  }

  private positionDropdown(textarea: HTMLTextAreaElement): void {
    this.dropdownTop.set(textarea.offsetHeight + 4);
    this.dropdownLeft.set(0);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (!this.showDropdown()) {
      return;
    }

    const flat = this.getFlatItems();

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.activeIndex.update((i) => Math.min(i + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.activeIndex.update((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" || event.key === "Tab") {
      if (flat.length > 0) {
        event.preventDefault();
        this.selectVariable(flat[this.activeIndex()]);
      }
    } else if (event.key === "Escape") {
      // Consume Escape here so it does not bubble to the document-level
      // listener in WorkflowBuilderComponent (which would also dismiss the
      // floating inspector and discard the user's editing context).
      event.stopPropagation();
      console.debug(
        "[TemplateAutocompleteComponent] Escape consumed — closing dropdown"
      );
      this.showDropdown.set(false);
    }
  }

  onBlur(): void {
    // Delay to allow mousedown on dropdown items to fire first.
    setTimeout(() => this.showDropdown.set(false), 200);
  }

  selectVariable(v: IVariableEntry): void {
    const val = this.value;
    const pos = this.cursorPos;
    const before = val.substring(0, pos);
    const lastOpen = before.lastIndexOf("{{");
    const after = val.substring(pos);
    const newVal = val.substring(0, lastOpen) + "{{" + v.path + "}}" + after;
    this.value = newVal;
    this.valueChange.emit(newVal);
    this.showDropdown.set(false);

    // Restore focus and place cursor after the inserted expression.
    requestAnimationFrame(() => {
      const textarea = this.textareaRef?.nativeElement;
      if (textarea) {
        textarea.focus();
        const newPos = lastOpen + v.path.length + 4; // {{ + path + }}
        textarea.setSelectionRange(newPos, newPos);
      }
    });
  }

  getGlobalIndex(group: IVariableGroup, v: IVariableEntry): number {
    let idx = 0;
    for (const g of this.filteredGroups()) {
      for (const item of g.variables) {
        if (item === v) {
          return idx;
        }
        idx++;
      }
    }
    return 0;
  }

  private getFlatItems(): IVariableEntry[] {
    return this.filteredGroups().flatMap((g) => g.variables);
  }

  @HostListener("document:click", ["$event"])
  onDocumentClick(event: MouseEvent): void {
    if (
      this.wrapperRef &&
      !this.wrapperRef.nativeElement.contains(event.target as Node)
    ) {
      this.showDropdown.set(false);
    }
  }
}
