import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";

export interface IDetailDialogField {
  label: string;
  value: string;
}

export interface IDetailDialogData {
  title: string;
  subtitle?: string;
  fields: IDetailDialogField[];
}

/**
 * Generic detail-overlay primitive. Per the SPEC decision, detail overlays
 * reuse MatDialog rather than a custom modal — this component only supplies
 * the redesign layout (header + close affordance + a key/value field list,
 * see the event-inspector header at `Rediseño Terminal.dc.html` lines
 * 952-958 for the close-button styling and the `dl`/`dt`/`dd` field list at
 * lines 978-979). Open it with the global `rd-dialog-panel` panel class
 * (see `styles.scss`) so the surrounding `.mat-mdc-dialog-container` picks
 * up the `--rd-*` token theme.
 */
@Component({
  selector: "app-detail-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatIconModule],
  template: `
    <div class="dialog-header">
      <span class="dialog-heading">
        <span class="dialog-title">{{ data.title }}</span>
        @if (data.subtitle) {
          <span class="dialog-subtitle">{{ data.subtitle }}</span>
        }
      </span>
      <button
        type="button"
        class="dialog-close"
        (click)="close()"
        aria-label="Close"
      >
        <mat-icon class="dialog-close-icon">close</mat-icon>
      </button>
    </div>
    <mat-dialog-content class="dialog-content">
      @if (fieldsWithEmptyLog().length === 0) {
        <p class="dialog-empty">No details available</p>
      } @else {
        <dl class="dialog-fields">
          @for (field of fieldsWithEmptyLog(); track field.label) {
            <dt>{{ field.label }}</dt>
            <dd>{{ field.value }}</dd>
          }
        </dl>
      }
    </mat-dialog-content>
  `,
  styles: `
    :host {
      display: block;
      min-width: 360px;
      max-width: 560px;
    }
    .dialog-header {
      display: flex;
      align-items: flex-start;
      gap: var(--rd-space-5, 10px);
      padding: var(--rd-space-7, 14px) var(--rd-space-9, 18px);
      border-bottom: 1px solid var(--rd-line);
    }
    .dialog-heading {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .dialog-title {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-lg, 15px);
      font-weight: 600;
      color: var(--rd-text-1);
    }
    .dialog-subtitle {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      color: var(--rd-text-3);
    }
    .dialog-close {
      width: 26px;
      height: 26px;
      border: none;
      background: transparent;
      border-radius: var(--rd-radius-5, 6px);
      color: var(--rd-text-2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      padding: 0;
    }
    .dialog-close:hover {
      background: var(--rd-hover);
    }
    .dialog-close-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .dialog-content {
      padding: var(--rd-space-8, 16px) var(--rd-space-9, 18px);
    }
    .dialog-fields {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--rd-space-4, 8px) var(--rd-space-6, 12px);
      margin: 0;
      font-size: var(--rd-text-size-sm, 12px);
    }
    .dialog-fields dt {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--rd-text-3);
    }
    .dialog-fields dd {
      margin: 0;
      color: var(--rd-text-1);
      word-break: break-word;
    }
    .dialog-empty {
      margin: 0;
      color: var(--rd-text-3);
      font-size: var(--rd-text-size-base, 13px);
    }
  `,
})
export class DetailDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<DetailDialogComponent>>(MatDialogRef);
  readonly data = inject<IDetailDialogData>(MAT_DIALOG_DATA);

  readonly fieldsWithEmptyLog = computed(() => {
    const fields = this.data.fields ?? [];
    if (fields.length === 0) {
      // Verbose logging: a detail dialog with no fields must not fail silently.
      console.debug("[DetailDialogComponent] opened with an empty field list", {
        title: this.data.title,
      });
    }
    return fields;
  });

  close(): void {
    this.dialogRef.close();
  }
}
