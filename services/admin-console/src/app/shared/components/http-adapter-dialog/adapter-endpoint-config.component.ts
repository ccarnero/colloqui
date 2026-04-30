import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from "@angular/core";
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import type { HttpMethod } from "../../models/http-adapter.model";
import { AdapterCacheStrategyFormComponent } from "./adapter-cache-strategy-form.component";
import { HTTP_METHODS } from "./http-adapter-dialog.types";

@Component({
  selector: "app-adapter-endpoint-config",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    AdapterCacheStrategyFormComponent,
  ],
  template: `
    <div class="section-card">
      <div class="section-card-header">
        <div class="section-card-title">Endpoints</div>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          (click)="addEndpoint()"
        >
          <mat-icon class="btn-add-icon">add</mat-icon>
          Add
        </button>
      </div>
      <div class="section-card-body">
        @for (ep of endpoints().controls; track ep; let i = $index) {
          <div class="endpoint-card" [formGroup]="endpointGroup(i)">
            <div class="form-row list-row">
              <mat-form-field appearance="outline" class="form-field-method">
                <mat-label>Method</mat-label>
                <mat-select formControlName="method">
                  @for (m of httpMethods; track m) {
                    <mat-option [value]="m">{{ m }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="form-field-path">
                <mat-label>Path</mat-label>
                <input
                  matInput
                  formControlName="path"
                  placeholder="/api/resource"
                />
              </mat-form-field>
              <mat-form-field appearance="outline" class="form-field-label">
                <mat-label>Label</mat-label>
                <input
                  matInput
                  formControlName="label"
                  placeholder="Get resource"
                />
              </mat-form-field>
              <button
                type="button"
                class="btn btn-icon btn-danger-icon"
                aria-label="Remove endpoint"
                (click)="removeEndpoint(i)"
              >
                <mat-icon>close</mat-icon>
              </button>
            </div>

            <app-adapter-cache-strategy-form
              [group]="endpointCacheGroup(i)"
              [title]="'Cache'"
              [subtitle]="'Memoize responses for this endpoint'"
            />
          </div>
        }
        @if (endpoints().length === 0) {
          <div class="empty-hint">No endpoints configured</div>
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

    .endpoint-card {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
    }

    .endpoint-card:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .form-field-method {
      width: 110px;
      flex-shrink: 0;
    }

    .form-field-path {
      flex: 1;
    }

    .form-field-label {
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
      transition: color 0.15s, background 0.15s;
      flex-shrink: 0;
    }

    .btn-danger-icon:hover {
      color: var(--red);
      background: var(--red-dim);
    }

    .btn-danger-icon mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .empty-hint {
      font-size: 12px;
      color: var(--text3);
      padding: 4px 0;
    }
  `,
})
export class AdapterEndpointConfigComponent {
  private readonly fb = inject(FormBuilder);

  readonly endpoints = input.required<FormArray>();

  readonly httpMethods = HTTP_METHODS;

  endpointGroup(index: number): FormGroup {
    return this.endpoints().at(index) as FormGroup;
  }

  endpointCacheGroup(index: number): FormGroup {
    return this.endpointGroup(index).get("cache") as FormGroup;
  }

  addEndpoint(): void {
    this.endpoints().push(this.createEndpointGroup());
  }

  removeEndpoint(index: number): void {
    this.endpoints().removeAt(index);
  }

  private createEndpointGroup(): FormGroup {
    return this.fb.group({
      id: [null as string | null],
      label: ["", Validators.required],
      method: ["GET" as HttpMethod, Validators.required],
      path: ["", Validators.required],
      cache: this.createCacheGroup(),
    });
  }

  private createCacheGroup(): FormGroup {
    return this.fb.group({
      enabled: [false],
      ttlSeconds: [60, [Validators.required, Validators.min(1)]],
      methods: [["GET", "HEAD"] as HttpMethod[], Validators.required],
      keyBody: [false],
      keyHeaders: [[] as string[]],
      queryParamsMode: ["all"],
      keyQueryParamsList: [[] as string[]],
    });
  }
}
