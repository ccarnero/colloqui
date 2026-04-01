import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";

@Component({
  selector: "app-yoizenclaw-top-bar",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">YoizenClaw Agents</div>
      </div>
      <div class="ws-actions">
        @if (editingAgentId()) {
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            [disabled]="saving()"
            (click)="cancelEdit.emit()"
          >
            <mat-icon>close</mat-icon>
            Cancel
          </button>
        }
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
      </div>
    </div>

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
})
export class YoizenclawTopBarComponent {
  readonly editingAgentId = input.required<string | null>();
  readonly saving = input.required<boolean>();
  readonly loading = input.required<boolean>();
  readonly canSave = input.required<boolean>();
  readonly errorMessage = input.required<string>();
  readonly successMessage = input.required<string>();

  readonly cancelEdit = output<void>();
  readonly reset = output<void>();
  readonly save = output<void>();
}
