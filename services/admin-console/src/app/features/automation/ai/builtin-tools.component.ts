import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import type { IBuiltinTool } from "../../../core/models/agent.model";
import { EditDescriptionDialogComponent } from "./edit-description-dialog.component";

export interface IBuiltinToolToggle {
  name: string;
  description: string;
  readOnly: boolean;
  enabled: boolean;
  effectiveDescription: string;
  hasOverride: boolean;
}

@Component({
  selector: "app-ai-builtin-tools",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <div class="section-card-body">
      <div class="builtin-header">
        <div class="builtin-header-text">
          <span class="text-muted text-sm">
            Platform built-in tools available to this agent. Toggle tools on or
            off, then save your changes. Click the edit icon to customize a
            tool's description for this agent.
          </span>
        </div>
        <div class="builtin-header-actions">
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            (click)="selectAll()"
            [disabled]="saving() || toolToggles().length === 0"
          >
            Select All
          </button>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            (click)="deselectAll()"
            [disabled]="saving() || toolToggles().length === 0"
          >
            Deselect All
          </button>
          <button
            class="btn btn-primary btn-sm"
            type="button"
            (click)="save()"
            [disabled]="saving() || !hasChanges()"
          >
            @if (saving()) {
              <mat-spinner diameter="16" />
            } @else {
              <mat-icon>save</mat-icon>
            }
            Save
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="24" />
          <span>Loading built-in tools...</span>
        </div>
      }

      @if (!loading() && toolToggles().length === 0) {
        <div class="empty-state">
          <mat-icon>build</mat-icon>
          <p>No built-in tools available.</p>
          <p class="text-muted text-sm">
            Built-in tools are provided by the platform and become available
            when the AI service is running.
          </p>
        </div>
      }

      @if (toolToggles().length > 0) {
        <div class="tools-grid">
          @for (tool of toolToggles(); track tool.name) {
            <article
              class="tool-card"
              [class.readonly]="tool.readOnly"
              [class.disabled]="tool.readOnly && !tool.enabled"
              [class.has-override]="tool.hasOverride"
            >
              <div class="tool-card-top">
                <div class="tool-info">
                  <div class="tool-name-row">
                    <span class="tool-name">{{ tool.name }}</span>
                    @if (tool.readOnly) {
                      <span class="readonly-badge">read-only</span>
                    }
                    @if (tool.hasOverride) {
                      <span class="override-badge">overridden</span>
                    }
                    <button
                      type="button"
                      class="edit-desc-btn"
                      (click)="openEditDescriptionDialog(tool)"
                      title="Edit description"
                    >
                      <mat-icon>edit</mat-icon>
                    </button>
                  </div>
                  <p class="tool-desc" [class.overridden]="tool.hasOverride">
                    {{ tool.effectiveDescription }}
                  </p>
                  @if (tool.hasOverride) {
                    <button
                      type="button"
                      class="reset-link"
                      (click)="resetOverride(tool.name)"
                    >
                      Reset to default
                    </button>
                  }
                </div>
                <label class="toggle-label">
                  <mat-checkbox
                    [checked]="tool.enabled"
                    [disabled]="tool.readOnly"
                    (change)="onToggle(tool.name, $event.checked)"
                    color="primary"
                  />
                </label>
              </div>
            </article>
          }
        </div>
      }

      @if (error()) {
        <div class="alert alert-error">
          <mat-icon>error</mat-icon>
          <span>{{ error() }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    .builtin-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .builtin-header-text {
      flex: 1;
      min-width: 200px;
    }

    .builtin-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 12px;
    }

    .tool-card {
      padding: 14px 16px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.015);
      transition: all 0.15s ease;
    }

    .tool-card:hover {
      border-color: rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.025);
    }

    .tool-card.has-override {
      border-color: rgba(250, 204, 21, 0.2);
      background: rgba(250, 204, 21, 0.015);
    }

    .tool-card-top {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .tool-info {
      flex: 1;
      min-width: 0;
    }

    .tool-name-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
      flex-wrap: wrap;
    }

    .tool-name {
      font-weight: 600;
      font-size: 13.5px;
      color: var(--text-primary);
      font-family: "JetBrains Mono", ui-monospace, monospace;
    }

    .readonly-badge {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text3);
      background: var(--bg3);
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid var(--border-subtle);
    }

    .override-badge {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #ca8a04;
      background: rgba(250, 204, 21, 0.1);
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid rgba(250, 204, 21, 0.3);
    }

    .edit-desc-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: var(--text3);
      cursor: pointer;
      border-radius: 4px;
      transition: all 0.15s ease;
      padding: 0;
    }

    .edit-desc-btn:hover {
      color: var(--text-primary);
      background: rgba(255, 255, 255, 0.06);
    }

    .edit-desc-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .tool-desc {
      margin: 0;
      font-size: 12px;
      color: var(--text3);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .tool-desc.overridden {
      color: var(--text-secondary);
    }

    .reset-link {
      display: inline-block;
      font-size: 10px;
      color: #facc15;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      margin-top: 2px;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .reset-link:hover {
      color: #eab308;
    }

    .toggle-label {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .loading-state {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 24px;
      color: var(--text3);
      font-size: 13px;
    }

    .loading-state mat-spinner {
      flex-shrink: 0;
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

    .alert {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-top: 12px;
    }

    .alert-error {
      background: rgba(248, 113, 113, 0.08);
      border: 1px solid rgba(248, 113, 113, 0.2);
      color: #f87171;
    }

    .alert-error mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .btn-ghost {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 12px;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
      background: transparent;
      color: var(--text3);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-ghost:hover:not(:disabled) {
      border-color: var(--border2);
      color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.03);
    }

    .btn-ghost:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .btn-primary {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 14px;
      border-radius: 6px;
      border: 1px solid var(--primary);
      background: var(--primary);
      color: white;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-primary mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .btn-primary:hover:not(:disabled) {
      opacity: 0.9;
    }

    .btn-primary:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    @media (max-width: 720px) {
      .builtin-header {
        flex-direction: column;
      }

      .tools-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AiBuiltinToolsComponent {
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly agentId = input.required<string>();
  readonly enabledTools = input.required<string[] | null>();
  readonly toolDescriptionOverrides = input<Record<string, string> | null>(null);

  readonly toolsSaved = output<string[] | null>();
  readonly toolDescriptionsSaved = output<Record<string, string> | null>();

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savingDescriptions = signal(false);
  readonly error = signal("");
  readonly toolToggles = signal<IBuiltinToolToggle[]>([]);
  private initialSnapshot: string = "";
  /** The last-saved overrides map (used to detect changes) */
  private savedOverrides: Record<string, string> = {};

  readonly hasChanges = computed(() => {
    const current = this.toolToggles()
      .filter((t) => t.enabled)
      .map((t) => t.name)
      .sort()
      .join(",");
    return current !== this.initialSnapshot;
  });

  constructor() {
    this.loadBuiltinTools();
  }

  private loadBuiltinTools(): void {
    this.loading.set(true);
    this.error.set("");

    this.agentAdminService.listBuiltinTools().subscribe({
      next: (tools) => {
        const enabledNames = this.enabledTools();
        const overrides = this.toolDescriptionOverrides() ?? {};

        this.savedOverrides = { ...overrides };

        const toggles: IBuiltinToolToggle[] = tools.map((tool) => {
          const override = overrides[tool.name];
          return {
            name: tool.name,
            description: tool.description,
            readOnly: tool.readOnly ?? false,
            enabled:
              enabledNames === null
                ? true
                : enabledNames.includes(tool.name),
            effectiveDescription: override ?? tool.description,
            hasOverride: override !== undefined,
          };
        });
        this.toolToggles.set(toggles);
        this.captureSnapshot(toggles);
        this.loading.set(false);
      },
      error: () => {
        this.error.set("Failed to load built-in tools.");
        this.loading.set(false);
      },
    });
  }

  private captureSnapshot(toggles: IBuiltinToolToggle[]): void {
    this.initialSnapshot = toggles
      .filter((t) => t.enabled)
      .map((t) => t.name)
      .sort()
      .join(",");
  }

  onToggle(name: string, checked: boolean): void {
    this.toolToggles.update((toggles) =>
      toggles.map((t) => (t.name === name ? { ...t, enabled: checked } : t)),
    );
  }

  selectAll(): void {
    this.toolToggles.update((toggles) =>
      toggles.map((t) => ({ ...t, enabled: true })),
    );
  }

  deselectAll(): void {
    this.toolToggles.update((toggles) =>
      toggles.map((t) => (t.readOnly ? t : { ...t, enabled: false })),
    );
  }

  resetOverride(toolName: string): void {
    const toggles = this.toolToggles();
    const tool = toggles.find((t) => t.name === toolName);
    if (!tool) return;

    // Remove this override from the saved map
    const { [toolName]: _, ...rest } = this.savedOverrides;
    const newOverrides = Object.keys(rest).length > 0 ? rest : null;

    this.savingDescriptions.set(true);
    this.error.set("");

    this.agentAdminService
      .updateToolDescriptionOverrides(this.agentId(), newOverrides)
      .subscribe({
        next: () => {
          this.savedOverrides = newOverrides ?? {};
          this.toolToggles.update((tgs) =>
            tgs.map((t) =>
              t.name === toolName
                ? { ...t, effectiveDescription: tool.description, hasOverride: false }
                : t,
            ),
          );
          this.toolDescriptionsSaved.emit(newOverrides);
          this.savingDescriptions.set(false);
          this.snackBar.open("Description reset to default.", undefined, {
            duration: 2000,
          });
        },
        error: () => {
          this.error.set("Failed to reset description.");
          this.savingDescriptions.set(false);
        },
      });
  }

  openEditDescriptionDialog(tool: IBuiltinToolToggle): void {
    const defaultDesc = tool.description;
    const currentOverride = this.savedOverrides[tool.name] ?? "";

    const dialogRef = this.dialog.open(EditDescriptionDialogComponent, {
      width: "520px",
      data: {
        toolName: tool.name,
        defaultDescription: defaultDesc,
        currentOverride,
      },
    });

    dialogRef.afterClosed().subscribe((result: string | undefined) => {
      if (result === undefined) return; // cancelled

      const newOverrides = { ...this.savedOverrides };

      if (result === "") {
        // User cleared the override (reset to default)
        delete newOverrides[tool.name];
      } else {
        newOverrides[tool.name] = result.trim();
      }

      const payload =
        Object.keys(newOverrides).length > 0 ? newOverrides : null;

      this.savingDescriptions.set(true);
      this.error.set("");

      this.agentAdminService
        .updateToolDescriptionOverrides(this.agentId(), payload)
        .subscribe({
          next: () => {
            this.savedOverrides = newOverrides;
            this.toolToggles.update((tgs) =>
              tgs.map((t) => {
                if (t.name !== tool.name) return t;
                const override = newOverrides[t.name];
                return {
                  ...t,
                  effectiveDescription: override ?? t.description,
                  hasOverride: override !== undefined,
                };
              }),
            );
            this.toolDescriptionsSaved.emit(payload);
            this.savingDescriptions.set(false);
            this.snackBar.open(
              result
                ? "Description updated successfully."
                : "Description reset to default.",
              undefined,
              { duration: 2000 },
            );
          },
          error: () => {
            this.error.set("Failed to save description override.");
            this.savingDescriptions.set(false);
          },
        });
    });
  }

  save(): void {
    const agentId = this.agentId();
    const toggles = this.toolToggles();

    const enabledTools = toggles.filter((t) => t.enabled).map((t) => t.name);

    // If all tools are enabled, send null (server default = all enabled)
    const allEnabled = toggles.every((t) => t.enabled);
    const payload = allEnabled ? null : enabledTools;

    this.saving.set(true);
    this.error.set("");

    this.agentAdminService.updateEnabledTools(agentId, payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.captureSnapshot(this.toolToggles());
        this.toolsSaved.emit(payload);
        this.snackBar.open("Built-in tools updated successfully.", undefined, {
          duration: 3000,
        });
      },
      error: () => {
        this.error.set("Failed to save built-in tools configuration.");
        this.saving.set(false);
      },
    });
  }
}
