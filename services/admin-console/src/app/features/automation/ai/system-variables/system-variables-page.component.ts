import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import {
  SystemVariablesService,
  type ISystemVariable,
} from "../../../../core/services/system-variables.service";
import {
  SystemVariablesFormDialogComponent,
  type ISystemVariableFormResult,
} from "./system-variables-form-dialog.component";

const TYPE_COLORS: Record<string, string> = {
  string: "#42a5f5",
  number: "#66bb6a",
  boolean: "#ab47bc",
  json: "#ffa726",
  array: "#26a69a",
  secret: "#ef5350",
};

function previewValue(variable: ISystemVariable): string {
  switch (variable.type) {
    case "string": {
      const s = String(variable.value ?? "");
      return s.length > 60 ? s.slice(0, 60) + "..." : s;
    }
    case "number":
    case "boolean":
      return String(variable.value);
    case "json":
    case "array":
      return "[...]";
    case "secret":
      return "[hidden]";
    default:
      return String(variable.value ?? "");
  }
}

@Component({
  selector: "app-system-variables-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="system-variables-page">
      <div class="page-header">
        <div>
          <h1>System Variables</h1>
          <p class="text-secondary">
            Manage system-wide configuration variables for your agents
          </p>
        </div>
        <button class="btn btn-primary btn-sm" (click)="createVariable()">
          <mat-icon>add</mat-icon> New Variable
        </button>
      </div>

      <div class="variables-grid">
        @for (variable of variables(); track variable.id) {
          <div
            class="variable-card"
            [style.border-left-color]="typeColor(variable.type)"
          >
            <div class="variable-header">
              <div class="variable-info">
                <div class="variable-title-row">
                  <strong>{{ variable.name }}</strong>
                  <span
                    class="type-badge"
                    [style.background]="typeColor(variable.type) + '20'"
                    [style.color]="typeColor(variable.type)"
                  >
                    {{ variable.type }}
                  </span>
                </div>
                @if (variable.label) {
                  <span class="variable-label">{{ variable.label }}</span>
                }
              </div>
            </div>
            <div class="variable-value">
              {{ preview(variable) }}
            </div>
            @if (variable.description) {
              <div class="variable-desc">
                {{ variable.description }}
              </div>
            }
            <div class="variable-footer">
              <span class="variable-date">
                Updated {{ variable.updated_at | date:"short" }}
              </span>
              <div class="variable-actions">
                <button
                  class="icon-btn"
                  (click)="editVariable(variable)"
                  title="Edit"
                >
                  <mat-icon>edit</mat-icon>
                </button>
                <button
                  class="icon-btn danger"
                  (click)="deleteVariable(variable)"
                  title="Delete"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            </div>
          </div>
        } @empty {
          <div class="empty-state">
            <mat-icon>settings</mat-icon>
            <p>No system variables yet. Create your first one!</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
    .system-variables-page { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; }
    .variables-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .variable-card {
      background: var(--bg2); border: 1px solid var(--border-subtle); border-radius: 12px;
      border-left: 4px solid #42a5f5; padding: 16px; display: flex; flex-direction: column; gap: 10px;
    }
    .variable-header { display: flex; align-items: center; gap: 12px; }
    .variable-info { display: flex; flex-direction: column; gap: 2px; overflow: hidden; flex: 1; }
    .variable-title-row { display: flex; align-items: center; gap: 8px; }
    .variable-title-row strong { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .type-badge {
      padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; flex-shrink: 0;
    }
    .variable-label { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .variable-value {
      font-size: 12px; color: var(--text-muted); line-height: 1.5; background: var(--bg3);
      padding: 8px; border-radius: 6px; font-family: monospace;
    }
    .variable-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.4; }
    .variable-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .variable-date { font-size: 11px; color: var(--text-muted); }
    .variable-actions { display: flex; gap: 4px; flex-shrink: 0; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      border: 1px solid var(--border-subtle); border-radius: 8px; background: transparent;
      color: var(--text-muted); cursor: pointer;
    }
    .icon-btn:hover { color: var(--text-primary); border-color: var(--border2); }
    .icon-btn.danger:hover { color: #ef5350; border-color: #ef5350; }
    .empty-state { grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted); }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5; }
  `,
  ],
})
export class SystemVariablesPageComponent implements OnInit {
  private readonly service = inject(SystemVariablesService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly variables = signal<ISystemVariable[]>([]);

  typeColor(type: string): string {
    return TYPE_COLORS[type] ?? "#42a5f5";
  }

  preview(variable: ISystemVariable): string {
    return previewValue(variable);
  }

  ngOnInit(): void {
    this.loadVariables();
  }

  private loadVariables(): void {
    this.service.findAll().subscribe({
      next: (res) => this.variables.set(res.variables),
      error: () =>
        this.snackBar.open("Failed to load system variables", "OK", {
          duration: 3000,
        }),
    });
  }

  createVariable(): void {
    const ref = this.dialog.open(SystemVariablesFormDialogComponent, {
      width: "560px",
      data: {},
    });
    ref.afterClosed().subscribe((result: ISystemVariableFormResult | undefined) => {
      if (result) {
        this.service.create(result).subscribe({
          next: () => {
            this.loadVariables();
            this.snackBar.open("Variable created", "OK", { duration: 2000 });
          },
          error: () =>
            this.snackBar.open("Failed to create variable", "OK", {
              duration: 3000,
            }),
        });
      }
    });
  }

  editVariable(variable: ISystemVariable): void {
    const ref = this.dialog.open(SystemVariablesFormDialogComponent, {
      width: "560px",
      data: { variable },
    });
    ref.afterClosed().subscribe((result: ISystemVariableFormResult | undefined) => {
      if (result) {
        this.service.update(variable.id, result).subscribe({
          next: () => {
            this.loadVariables();
            this.snackBar.open("Variable updated", "OK", { duration: 2000 });
          },
          error: () =>
            this.snackBar.open("Failed to update variable", "OK", {
              duration: 3000,
            }),
        });
      }
    });
  }

  deleteVariable(variable: ISystemVariable): void {
    if (!confirm(`Delete variable "${variable.name}"?`)) return;
    this.service.delete(variable.id).subscribe({
      next: () => {
        this.loadVariables();
        this.snackBar.open("Variable deleted", "OK", { duration: 2000 });
      },
      error: () =>
        this.snackBar.open("Failed to delete variable", "OK", {
          duration: 3000,
        }),
    });
  }
}
