import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";

export interface EditDescriptionDialogData {
  toolName: string;
  defaultDescription: string;
  currentOverride: string;
}

const MAX_DESC_LENGTH = 2000;

@Component({
  selector: "app-edit-description-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Edit description — {{ data.toolName }}</h2>

    <mat-dialog-content>
      <div class="dialog-body">
        <!-- Default description (read-only) -->
        <mat-form-field appearance="fill" class="full-width">
          <mat-label>Default description</mat-label>
          <textarea
            matInput
            [value]="data.defaultDescription"
            disabled
            rows="2"
          ></textarea>
        </mat-form-field>

        <!-- Current override (editable) -->
        <mat-form-field appearance="fill" class="full-width">
          <mat-label>Custom description (optional)</mat-label>
          <textarea
            matInput
            [(ngModel)]="overrideText"
            (ngModelChange)="onTextChange()"
            rows="3"
            [maxlength]="MAX_DESC_LENGTH"
            placeholder="Enter a custom description for this agent..."
          ></textarea>
          <mat-hint align="end">{{ overrideText.length }}/{{ MAX_DESC_LENGTH }}</mat-hint>
        </mat-form-field>

        <div class="dialog-actions-row">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            (click)="resetToDefault()"
            [disabled]="overrideText === ''"
          >
            Reset to default
          </button>
        </div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="cancel()">Cancel</button>
      <button
        mat-button
        type="button"
        color="primary"
        (click)="save()"
        [disabled]="!hasChanges()"
      >
        Save
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 4px 0;
    }

    .full-width {
      width: 100%;
    }

    .dialog-actions-row {
      display: flex;
      align-items: center;
    }

    .btn-ghost {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 12px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: transparent;
      color: var(--text3);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-ghost:hover:not(:disabled) {
      border-color: rgba(255, 255, 255, 0.25);
      color: var(--text-secondary);
    }

    .btn-ghost:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `,
})
export class EditDescriptionDialogComponent {
  readonly dialogRef = inject(MatDialogRef<EditDescriptionDialogComponent>);
  readonly data: EditDescriptionDialogData = inject(MAT_DIALOG_DATA);

  readonly MAX_DESC_LENGTH = MAX_DESC_LENGTH;
  protected overrideText: string;
  private originalText: string;

  constructor() {
    this.overrideText = this.data.currentOverride;
    this.originalText = this.data.currentOverride;
  }

  onTextChange(): void {
    // Prevent exceeding max length
    if (this.overrideText.length > MAX_DESC_LENGTH) {
      this.overrideText = this.overrideText.slice(0, MAX_DESC_LENGTH);
    }
  }

  resetToDefault(): void {
    this.overrideText = "";
  }

  hasChanges(): boolean {
    return this.overrideText !== this.originalText;
  }

  save(): void {
    this.dialogRef.close(this.overrideText);
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
