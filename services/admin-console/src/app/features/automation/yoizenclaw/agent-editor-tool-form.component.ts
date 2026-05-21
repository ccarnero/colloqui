import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import type {
  IAgentToolDraft,
  ToolSourceType,
} from "../../../core/models/yoizenclaw.model";
import { ToolAdapterFormComponent } from "./tool-adapter-form.component";

/**
 * Center-pane editor for a single tool.
 * Emits `toolChange` events with new objects so the parent can update its array immutably.
 */
@Component({
  selector: "app-yoizenclaw-editor-tool-form",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
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
        <button
          type="button"
          class="icon-btn danger"
          aria-label="Remove tool"
          (click)="remove.emit()"
        >
          <mat-icon>delete</mat-icon>
        </button>
      </header>

      <div class="focus-grid">
        <mat-form-field appearance="outline">
          <mat-label>Tool Name</mat-label>
          <input
            matInput
            [ngModel]="tool().name"
            (ngModelChange)="onChange('name', $event)"
            placeholder="get-weather"
          />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <input
            matInput
            [ngModel]="tool().description ?? ''"
            (ngModelChange)="onChange('description', $event)"
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
          </div>
        </div>

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

    @media (max-width: 980px) {
      .focus-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class YoizenclawAgentEditorToolFormComponent {
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
}
