import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import type {
  IAgentToolDraft,
  IToolParameter,
  ToolSourceType,
} from "../../../core/models/agent.model";
import { ToolAdapterFormComponent } from "./tool-adapter-form.component";

/**
 * Center-pane editor for a single tool.
 * Emits `toolChange` events with new objects so the parent can update its array immutably.
 */
@Component({
  selector: "app-ai-editor-tool-form",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ToolAdapterFormComponent,
  ],
  template: `
    <div class="focus-card">
      <header class="focus-header">
        <div class="title-block">
          <span class="kicker">Tool</span>
          <h2 class="title">{{ tool().name || "New tool" }}</h2>
        </div>
        @if (tool().sourceType !== "builtin") {
          <button
            type="button"
            class="icon-btn danger"
            aria-label="Remove tool"
            (click)="remove.emit()"
          >
            <mat-icon>delete</mat-icon>
          </button>
        }
      </header>

      <div class="focus-grid">
        <mat-form-field appearance="outline">
          <mat-label>Tool Name</mat-label>
          <input
            matInput
            [ngModel]="tool().name"
            (ngModelChange)="onChange('name', $event)"
            [disabled]="tool().sourceType === 'builtin'"
            placeholder="get-weather"
          />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <input
            matInput
            [ngModel]="tool().description ?? ''"
            (ngModelChange)="onChange('description', $event)"
            [disabled]="tool().sourceType === 'builtin'"
            placeholder="What this tool does"
          />
        </mat-form-field>

        <div class="full-span">
          <div class="source-toggle">
            <button
              type="button"
              class="toggle-btn"
              [class.active]="tool().sourceType === 'http'"
              (click)="onSourceTypeChange('http')"
            >
              <mat-icon>language</mat-icon> HTTP Endpoint
            </button>
            <button
              type="button"
              class="toggle-btn"
              [class.active]="tool().sourceType === 'adapter'"
              (click)="onSourceTypeChange('adapter')"
            >
              <mat-icon>power</mat-icon> Adapter
            </button>
            <button
              type="button"
              class="toggle-btn"
              [class.active]="tool().sourceType === 'builtin'"
              (click)="onSourceTypeChange('builtin')"
            >
              <mat-icon>memory</mat-icon> Built-in
            </button>
          </div>
        </div>

        @if (tool().sourceType === "builtin") {
          <div class="full-span builtin-info">
            <mat-icon>verified</mat-icon>
            <span>Platform built-in tool — always available to the agent</span>
          </div>
        }

        @if (tool().sourceType === "http") {
          <mat-form-field appearance="outline">
            <mat-label>Endpoint URL</mat-label>
            <input
              matInput
              [ngModel]="tool().endpointUrl"
              (ngModelChange)="onChange('endpointUrl', $event)"
              placeholder="https://api.example.com/v1/resource"
            />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Method</mat-label>
            <mat-select
              [ngModel]="tool().endpointMethod"
              (ngModelChange)="onChange('endpointMethod', $event)"
            >
              <mat-option value="GET">GET</mat-option>
              <mat-option value="POST">POST</mat-option>
              <mat-option value="PUT">PUT</mat-option>
              <mat-option value="PATCH">PATCH</mat-option>
              <mat-option value="DELETE">DELETE</mat-option>
            </mat-select>
          </mat-form-field>

          <div class="full-span">
            <div class="params-header">
              <span class="params-label">Input Parameters</span>
              <button
                type="button"
                class="add-param-btn"
                (click)="addParameter()"
              >
                <mat-icon>add</mat-icon>
                Add Parameter
              </button>
            </div>

            @for (param of tool().parameters; track $index) {
              <div class="param-card">
                <div class="param-row">
                  <mat-form-field appearance="outline" class="param-name">
                    <mat-label>Name</mat-label>
                    <input
                      matInput
                      [ngModel]="param.name"
                      (ngModelChange)="
                        onParamChange($index, 'name', $event)
                      "
                      placeholder="location"
                    />
                  </mat-form-field>

                  <mat-form-field appearance="outline" class="param-type">
                    <mat-label>Type</mat-label>
                    <mat-select
                      [ngModel]="param.type"
                      (ngModelChange)="
                        onParamChange($index, 'type', $event)
                      "
                    >
                      <mat-option value="string">string</mat-option>
                      <mat-option value="number">number</mat-option>
                      <mat-option value="boolean">boolean</mat-option>
                      <mat-option value="object">object</mat-option>
                      <mat-option value="array">array</mat-option>
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field appearance="outline" class="param-desc">
                    <mat-label>Description</mat-label>
                    <input
                      matInput
                      [ngModel]="param.description ?? ''"
                      (ngModelChange)="
                        onParamChange($index, 'description', $event)
                      "
                      placeholder="City name"
                    />
                  </mat-form-field>

                  <label class="param-required">
                    <mat-checkbox
                      [ngModel]="param.required"
                      (ngModelChange)="
                        onParamChange($index, 'required', $event)
                      "
                      >Required</mat-checkbox
                    >
                  </label>

                  <button
                    type="button"
                    class="icon-btn danger param-remove"
                    (click)="removeParameter($index)"
                  >
                    <mat-icon>close</mat-icon>
                  </button>
                </div>

                @if (param.type === "string") {
                  <mat-form-field appearance="outline" class="param-enum">
                    <mat-label>Enum values (comma-separated)</mat-label>
                    <input
                      matInput
                      [ngModel]="param.enum?.join(', ') ?? ''"
                      (ngModelChange)="onParamEnumChange($index, $event)"
                      placeholder="C, F"
                    />
                  </mat-form-field>
                }
              </div>
            }

            @if (tool().parameters.length === 0) {
              <div class="params-empty">
                No parameters defined — tool accepts any input
              </div>
            }
          </div>
        }

        @if (tool().sourceType === "adapter") {
          <div class="full-span">
            <app-tool-adapter-form
              [initialAdapterRef]="tool().adapterRef"
              [initialAdapterName]="tool().name"
              (adapterRefChange)="onAdapterRefChange($event)"
            />
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .focus-card {
      display: flex;
      flex-direction: column;
      gap: 18px;
      padding: 20px 22px;
    }

    .focus-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .title-block {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .kicker {
      font-size: 10px;
      font-weight: 700;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .icon-btn {
      width: 32px;
      height: 32px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: transparent;
      color: var(--text3);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .icon-btn.danger:hover {
      color: #f87171;
      border-color: rgba(248, 113, 113, 0.3);
      background: rgba(248, 113, 113, 0.06);
    }

    .focus-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .full-span {
      grid-column: 1 / -1;
    }

    .source-toggle {
      display: flex;
      gap: 6px;
    }

    .toggle-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
      background: transparent;
      color: var(--text3);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .toggle-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .toggle-btn:hover {
      border-color: var(--border2);
      color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.03);
    }

    .toggle-btn.active {
      border-color: var(--primary);
      color: var(--primary);
      background: var(--accent-dim);
    }

    .builtin-info {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--accent-dim);
      border: 1px solid var(--primary);
      color: var(--primary);
      font-size: 13px;
      font-weight: 500;
    }

    .builtin-info mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .params-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .params-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .add-param-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
      background: transparent;
      color: var(--primary);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }

    .add-param-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .param-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      margin-bottom: 8px;
    }

    .param-row {
      display: grid;
      grid-template-columns: 1fr 100px 2fr auto auto;
      gap: 8px;
      align-items: center;
    }

    .param-name {
      min-width: 100px;
    }

    .param-type {
      min-width: 90px;
    }

    .param-desc {
      min-width: 150px;
    }

    .param-required {
      display: flex;
      align-items: center;
      height: 40px;
    }

    .param-remove {
      width: 28px;
      height: 28px;
    }

    .param-enum {
      width: 100%;
    }

    .params-empty {
      font-size: 12px;
      color: var(--text3);
      padding: 8px 0;
    }

    @media (max-width: 980px) {
      .focus-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AiAgentEditorToolFormComponent {
  readonly tool = input.required<IAgentToolDraft>();
  readonly remove = output<void>();
  readonly toolChange = output<IAgentToolDraft>();

  protected onChange<K extends keyof IAgentToolDraft>(
    field: K,
    value: IAgentToolDraft[K],
  ): void {
    this.toolChange.emit({ ...this.tool(), [field]: value });
  }

  protected onSourceTypeChange(sourceType: ToolSourceType): void {
    this.toolChange.emit({ ...this.tool(), sourceType });
  }

  protected onAdapterRefChange(
    ref: { adapterId: string; endpointId: string } | null,
  ): void {
    this.toolChange.emit({ ...this.tool(), adapterRef: ref });
  }

  addParameter(): void {
    const current = this.tool();
    this.toolChange.emit({
      ...current,
      parameters: [
        ...(current.parameters ?? []),
        { name: "", type: "string", description: "", required: false },
      ],
    });
  }

  removeParameter(index: number): void {
    const current = this.tool();
    this.toolChange.emit({
      ...current,
      parameters: (current.parameters ?? []).filter((_, i) => i !== index),
    });
  }

  onParamChange<K extends keyof IToolParameter>(
    index: number,
    field: K,
    value: IToolParameter[K],
  ): void {
    const current = this.tool();
    const params = [...(current.parameters ?? [])];
    params[index] = { ...params[index], [field]: value };
    this.toolChange.emit({ ...current, parameters: params });
  }

  onParamEnumChange(index: number, value: string): void {
    const current = this.tool();
    const params = [...(current.parameters ?? [])];
    params[index] = {
      ...params[index],
      enum: value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    };
    this.toolChange.emit({ ...current, parameters: params });
  }
}
