import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";

export interface IConfirmDialogData {
  title: string;
  message: string;
  /** Defaults to "Confirm". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * Visual style of the confirm button. `danger` highlights destructive
   * actions in red. Defaults to `primary`.
   */
  variant?: "primary" | "danger";
  /** Optional Material icon shown next to the title. */
  icon?: string;
}

/**
 * Generic confirm/cancel dialog. Resolves with `true` on confirm and
 * `false` (or `undefined`) on cancel/backdrop close.
 */
@Component({
  selector: "app-confirm-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      @if (data.icon) {
        <mat-icon
          class="dialog-title-icon"
          [class.is-danger]="variant() === 'danger'"
        >
          {{ data.icon }}
        </mat-icon>
      }
      {{ data.title }}
    </h2>
    <mat-dialog-content class="dialog-content">
      <p class="dialog-message">{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="cancel()">
        {{ data.cancelLabel ?? "Cancel" }}
      </button>
      <button
        mat-flat-button
        type="button"
        [color]="variant() === 'danger' ? 'warn' : 'primary'"
        (click)="confirm()"
      >
        {{ data.confirmLabel ?? "Confirm" }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      min-width: 360px;
      max-width: 480px;
    }
    .dialog-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .dialog-title-icon.is-danger {
      color: var(--red, #dc2626);
    }
    .dialog-content {
      padding-top: 8px;
    }
    .dialog-message {
      margin: 0;
      color: var(--text2);
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-line;
    }
  `,
})
export class ConfirmDialogComponent {
  private readonly dialogRef = inject<
    MatDialogRef<ConfirmDialogComponent, boolean>
  >(MatDialogRef);
  readonly data = inject<IConfirmDialogData>(MAT_DIALOG_DATA);

  readonly variant = computed(() => this.data.variant ?? "primary");

  confirm(): void {
    this.dialogRef.close(true);
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
