import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatIconModule } from "@angular/material/icon";
import {
  type IVariableGroup,
  type IVariableEntry,
} from "../template-autocomplete/template-autocomplete.component";

@Component({
  selector: "app-variables-reference",
  standalone: true,
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="vr-panel" [class.vr-collapsed]="collapsed()">
      <button
        class="vr-toggle"
        (click)="collapsed.update((v) => !v)"
        type="button"
      >
        <mat-icon>{{
          collapsed() ? "chevron_right" : "expand_more"
        }}</mat-icon>
        <span class="vr-toggle-label">Variables Reference</span>
        <span class="vr-toggle-hint">{{
          collapsed() ? "Click to see available variables" : ""
        }}</span>
      </button>

      @if (!collapsed()) {
        <div class="vr-content">
          @for (group of groups(); track group.namespace) {
            <div class="vr-group">
              <div class="vr-group-header">
                <span class="vr-icon">{{ group.icon }}</span>
                <span class="vr-namespace">{{ group.namespace }}</span>
                <span class="vr-desc">{{ groupDescription(group) }}</span>
              </div>
              <div class="vr-vars">
                @for (v of group.variables; track v.path) {
                  <div
                    class="vr-var"
                    (click)="copyVar(v)"
                    title="Click to copy"
                  >
                    <code class="vr-path">{{ v.path }}</code>
                    <span class="vr-var-desc">{{ v.description }}</span>
                    <code class="vr-example">{{ varExample(v) }}</code>
                  </div>
                }
              </div>
            </div>
          }

          <div class="vr-syntax">
            <strong>Syntax:</strong> Wrap any variable in double curly
            braces:
            <code>{{ "{{" }}variable.path{{ "}}" }}</code>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .vr-panel {
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        overflow: hidden;
        margin: 8px 16px 0;
        flex-shrink: 0;
      }
      .vr-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 6px 12px;
        border: none;
        background: var(--bg-surface, var(--bg2));
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary);
      }
      .vr-toggle:hover {
        background: var(--bg3, #f0f0f0);
      }
      .vr-toggle-label {
        flex: 1;
        text-align: left;
      }
      .vr-toggle-hint {
        font-weight: 400;
        color: var(--text3, #999);
        font-size: 11px;
      }
      .vr-content {
        padding: 8px 12px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .vr-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .vr-group-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 0;
      }
      .vr-icon {
        font-size: 14px;
      }
      .vr-namespace {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary);
      }
      .vr-desc {
        font-size: 11px;
        color: var(--text3, #999);
        margin-left: auto;
      }
      .vr-vars {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-left: 20px;
      }
      .vr-var {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.1s;
      }
      .vr-var:hover {
        background: var(--bg3, #f0f0f0);
      }
      .vr-path {
        font-size: 11px;
        font-family: var(--font-mono, monospace);
        color: var(--accent, #6366f1);
        white-space: nowrap;
      }
      .vr-var-desc {
        font-size: 11px;
        color: var(--text2, #666);
        flex: 1;
      }
      .vr-example {
        font-size: 10px;
        font-family: var(--font-mono, monospace);
        color: var(--text3, #999);
        white-space: nowrap;
      }
      .vr-syntax {
        font-size: 11px;
        color: var(--text2, #666);
        padding: 6px 8px;
        background: var(--bg3, #f0f0f0);
        border-radius: 4px;
      }
      .vr-syntax code {
        font-family: var(--font-mono, monospace);
        color: var(--accent, #6366f1);
        padding: 1px 4px;
        background: var(--bg-surface, #fff);
        border-radius: 3px;
      }
      .vr-collapsed .vr-toggle {
        border-bottom: none;
      }
    `,
  ],
})
export class VariablesReferenceComponent {
  readonly collapsed = signal(true);
  readonly groups = input<IVariableGroup[]>([]);

  groupDescription(group: IVariableGroup): string {
    const count = group.variables.length;
    return `${count} variable${count !== 1 ? "s" : ""}`;
  }

  varExample(v: IVariableEntry): string {
    return v.example ?? `{{${v.path}}}`;
  }

  copyVar(v: IVariableEntry): void {
    const text = `{{${v.path}}}`;
    navigator.clipboard.writeText(text);
  }
}
