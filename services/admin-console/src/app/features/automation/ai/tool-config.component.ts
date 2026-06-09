import { ChangeDetectionStrategy, Component, model } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import type { IAgentToolDraft } from "../../../core/models/agent.model";
import { ToolAdapterFormComponent } from "./tool-adapter-form.component";

@Component({
  selector: "app-ai-tool-config",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ToolAdapterFormComponent,
  ],
  template: `
    <div class="section-card-body">
      <div class="flex items-center justify-between mb-16">
        <span class="text-muted text-sm">
          Connect external APIs and services to your agent.
        </span>
        <button class="btn btn-secondary btn-sm" type="button" (click)="addTool()">
          <mat-icon>add</mat-icon> Add Tool
        </button>
      </div>

      @if (tools().length === 0) {
        <div class="empty-state">
          <mat-icon>build</mat-icon>
          <p>No tools configured yet.</p>
          <p class="text-muted text-sm">
            Add an HTTP endpoint or connect a registered adapter.
          </p>
        </div>
      }

      <div class="subagent-stack">
        @for (tool of tools(); track $index) {
          <article class="subagent-card">
            <div class="subagent-header">
              <strong>{{ tool.name || "New Tool" }}</strong>
              <button
                class="icon-btn"
                type="button"
                aria-label="Remove tool"
                (click)="removeTool($index)"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </div>

            <div class="subagent-grid">
              <mat-form-field appearance="outline">
                <mat-label>Tool Name</mat-label>
                <input matInput [(ngModel)]="tool.name" placeholder="get-weather" />
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Description</mat-label>
                <input
                  matInput
                  [(ngModel)]="tool.description"
                  placeholder="What this tool does"
                />
              </mat-form-field>

              <div class="full-span">
                <div class="source-toggle">
                  <button
                    type="button"
                    class="toggle-btn"
                    [class.active]="tool.sourceType === 'http'"
                    (click)="tool.sourceType = 'http'"
                  >
                    <mat-icon>language</mat-icon> HTTP Endpoint
                  </button>
                  <button
                    type="button"
                    class="toggle-btn"
                    [class.active]="tool.sourceType === 'adapter'"
                    (click)="tool.sourceType = 'adapter'"
                  >
                    <mat-icon>power</mat-icon> Adapter
                  </button>
                </div>
              </div>

              @if (tool.sourceType === "http") {
                <mat-form-field appearance="outline">
                  <mat-label>Endpoint URL</mat-label>
                  <input
                    matInput
                    [(ngModel)]="tool.endpointUrl"
                    placeholder="https://api.example.com/v1/resource"
                  />
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>Method</mat-label>
                  <mat-select [(ngModel)]="tool.endpointMethod">
                    <mat-option value="GET">GET</mat-option>
                    <mat-option value="POST">POST</mat-option>
                    <mat-option value="PUT">PUT</mat-option>
                    <mat-option value="PATCH">PATCH</mat-option>
                    <mat-option value="DELETE">DELETE</mat-option>
                  </mat-select>
                </mat-form-field>
              }

              @if (tool.sourceType === "adapter") {
                <div class="full-span">
                  <app-tool-adapter-form
                    [initialAdapterRef]="tool.adapterRef"
                    [initialAdapterName]="tool.name"
                    (adapterRefChange)="onToolAdapterRefChange($index, $event)"
                  />
                </div>
              }
            </div>
          </article>
        }
      </div>
    </div>
  `,
  styles: `
    .subagent-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .full-span {
      grid-column: 1 / -1;
    }

    .subagent-stack {
      display: grid;
      gap: 14px;
    }

    .subagent-card {
      padding: 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.015);
      display: grid;
      gap: 12px;
    }

    .subagent-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: transparent;
      color: var(--text3);
      cursor: pointer;
    }

    .icon-btn:hover {
      color: var(--text-primary);
      border-color: var(--border2);
      background: rgba(255, 255, 255, 0.03);
    }

    .source-toggle {
      display: flex;
      gap: 6px;
      margin-bottom: 4px;
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

    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: rgba(255, 255, 255, 0.4);
      border: 2px dashed rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.005);
      margin-bottom: 14px;
    }

    .empty-state p {
      margin: 0;
    }

    .empty-state mat-icon {
      margin-bottom: 12px;
      font-size: 32px;
      height: 32px;
      width: 32px;
      opacity: 0.7;
    }

    .mb-16 {
      margin-bottom: 16px;
    }
  `,
})
export class AiToolConfigComponent {
  readonly tools = model<IAgentToolDraft[]>([]);

  addTool(): void {
    this.tools.update((items) => [
      ...items,
      {
        name: "",
        description: "",
        sourceType: "http",
        endpointUrl: "",
        endpointMethod: "GET",
        adapterRef: null,
        parameters: [],
      },
    ]);
  }

  removeTool(index: number): void {
    this.tools.update((items) => items.filter((_, i) => i !== index));
  }

  onToolAdapterRefChange(
    index: number,
    ref: { adapterId: string; endpointId: string } | null,
  ): void {
    this.tools.update((items) =>
      items.map((t, i) => (i === index ? { ...t, adapterRef: ref } : t)),
    );
  }
}
