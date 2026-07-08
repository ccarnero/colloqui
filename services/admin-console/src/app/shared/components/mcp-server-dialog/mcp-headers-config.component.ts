import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from "@angular/core";
import {
  type FormArray,
  FormBuilder,
  type FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";

/**
 * Structured key/value headers editor — replaces the raw JSON textarea the
 * old inline modal used. Same add/remove-row interaction class as
 * `adapter-endpoint-config.component.ts`, simplified to just key/value pairs
 * (no endpoint-specific fields, mcp-connections.md §6.4).
 */
@Component({
  selector: "app-mcp-headers-config",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  template: `
    <div class="section-card">
      <div class="section-card-header">
        <div class="section-card-title">Custom Headers</div>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          (click)="addHeader()"
        >
          <mat-icon class="btn-add-icon">add</mat-icon>
          Add
        </button>
      </div>
      <div class="section-card-body">
        @for (hdr of headers().controls; track hdr; let i = $index) {
          <div class="form-row list-row" [formGroup]="headerGroup(i)">
            <mat-form-field appearance="outline" class="form-field-half">
              <mat-label>Key</mat-label>
              <input matInput formControlName="key" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="form-field-half">
              <mat-label>Value</mat-label>
              <input matInput formControlName="value" />
            </mat-form-field>
            <button
              type="button"
              class="btn btn-icon btn-danger-icon"
              aria-label="Remove header"
              (click)="removeHeader(i)"
            >
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }
        @if (headers().length === 0) {
          <div class="empty-hint">No custom headers configured</div>
        }
      </div>
    </div>
  `,
  styles: `
    .section-card-title {
      font-size: 12px;
    }
    .section-card-header {
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .section-card-body {
      padding: 14px;
    }
    .form-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .list-row {
      margin-bottom: 4px;
      align-items: center;
    }
    .form-field-half {
      flex: 1;
    }
    .btn-add-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .btn-danger-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      color: var(--text3);
      padding: 4px;
      border-radius: var(--radius);
      cursor: pointer;
      flex-shrink: 0;
    }
    .btn-danger-icon:hover {
      color: var(--red);
      background: var(--red-dim);
    }
    .empty-hint {
      font-size: 12px;
      color: var(--text3);
      padding: 4px 0;
    }
  `,
})
export class McpHeadersConfigComponent {
  private readonly fb = inject(FormBuilder);

  readonly headers = input.required<FormArray>();

  headerGroup(index: number): FormGroup {
    return this.headers().at(index) as FormGroup;
  }

  addHeader(): void {
    this.headers().push(
      this.fb.group({
        key: ["", Validators.required],
        value: ["", Validators.required],
      })
    );
  }

  removeHeader(index: number): void {
    this.headers().removeAt(index);
  }
}
