import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";

@Component({
  selector: "app-ai-top-bar",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, PageHeaderComponent],
  template: `
    <app-page-header title="AI Agents">
      @if (isDirty()) {
        <span
          class="dirty-pill"
          slot="status"
          title="You have unsaved local changes"
        >
          <span class="dirty-dot" aria-hidden="true"></span>
          Unsaved changes
        </span>
      }
      <ng-container slot="actions">
        <button
          class="btn btn-secondary btn-sm"
          type="button"
          [disabled]="saving()"
          (click)="cancelEdit.emit()"
        >
          <mat-icon>{{ editingAgentId() ? 'close' : 'arrow_back' }}</mat-icon>
          {{ editingAgentId() ? 'Cancel' : 'Back to List' }}
        </button>
        <button
          class="btn btn-secondary btn-sm"
          type="button"
          [disabled]="saving()"
          (click)="reset.emit()"
        >
          <mat-icon>refresh</mat-icon>
          {{ editingAgentId() ? "Reset" : "Reset Template" }}
        </button>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          [disabled]="saving() || loading() || !canSave()"
          (click)="save.emit()"
        >
          <mat-icon>{{
            saving() ? "hourglass_top" : editingAgentId() ? "update" : "save"
          }}</mat-icon>
          {{
            saving()
              ? "Saving..."
              : editingAgentId()
                ? "Update Agent"
                : "Create Agent"
          }}
        </button>
      </ng-container>
    </app-page-header>

    @if (errorMessage()) {
      <div class="alert alert-error">
        <mat-icon>error_outline</mat-icon>
        <div>{{ errorMessage() }}</div>
      </div>
    }

    @if (successMessage()) {
      <div class="alert alert-success">
        <mat-icon>check_circle</mat-icon>
        <div>{{ successMessage() }}</div>
      </div>
    }
  `,
  styles: `
    .dirty-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(253, 189, 39, 0.12);
      color: #fdbd27;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      border: 1px solid rgba(253, 189, 39, 0.3);
    }

    .dirty-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #fdbd27;
    }
  `,
})
export class AiTopBarComponent {
  readonly editingAgentId = input.required<string | null>();
  readonly saving = input.required<boolean>();
  readonly loading = input.required<boolean>();
  readonly canSave = input.required<boolean>();
  readonly errorMessage = input.required<string>();
  readonly successMessage = input.required<string>();
  readonly isDirty = input<boolean>(false);

  readonly cancelEdit = output<void>();
  readonly reset = output<void>();
  readonly save = output<void>();
}
