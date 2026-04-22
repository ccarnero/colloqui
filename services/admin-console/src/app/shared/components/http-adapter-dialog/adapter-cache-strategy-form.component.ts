import {
  ChangeDetectionStrategy,
  Component,
  input,
} from "@angular/core";
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from "@angular/forms";
import { COMMA, ENTER } from "@angular/cdk/keycodes";
import { MatButtonModule } from "@angular/material/button";
import { MatChipsModule } from "@angular/material/chips";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import type { HttpMethod } from "../../models/http-adapter.model";
import { HTTP_METHODS } from "./http-adapter-dialog.types";

const MUTATING_METHODS = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);

@Component({
  selector: "app-adapter-cache-strategy-form",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatChipsModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  template: `
    <div class="cache-panel" [formGroup]="group()">
      <mat-expansion-panel [expanded]="enabledControl().value">
        <mat-expansion-panel-header>
          <mat-panel-title>{{ title() }}</mat-panel-title>
          @if (subtitle()) {
            <mat-panel-description>{{ subtitle() }}</mat-panel-description>
          }
        </mat-expansion-panel-header>

        <div class="cache-body">
          <mat-slide-toggle formControlName="enabled">
            Enable response cache
          </mat-slide-toggle>

          <div class="form-row form-row-triple">
            <mat-form-field appearance="outline">
              <mat-label>TTL (seconds)</mat-label>
              <input
                matInput
                type="number"
                formControlName="ttlSeconds"
                [disabled]="!enabledControl().value"
              />
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Methods</mat-label>
              <mat-select
                formControlName="methods"
                multiple
                [disabled]="!enabledControl().value"
                (selectionChange)="syncKeyBodyDefault()"
              >
                @for (method of httpMethods; track method) {
                  <mat-option [value]="method">{{ method }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <div class="toggle-stack">
              <mat-slide-toggle
                formControlName="keyBody"
                [disabled]="!enabledControl().value"
              >
                Include body in cache key
              </mat-slide-toggle>
            </div>
          </div>

          <div class="form-row">
            <mat-form-field appearance="outline" class="form-field-half">
              <mat-label>Query params</mat-label>
              <mat-select
                formControlName="queryParamsMode"
                [disabled]="!enabledControl().value"
              >
                <mat-option value="all">All query params</mat-option>
                <mat-option value="custom">Selected only</mat-option>
              </mat-select>
            </mat-form-field>
          </div>

          @if (queryParamsModeControl().value === "custom") {
            <mat-form-field appearance="outline" class="form-field-full">
              <mat-label>Key query params</mat-label>
              <mat-chip-grid #queryChipGrid>
                @for (param of keyQueryParamsList(); track param) {
                  <mat-chip-row (removed)="removeListValue('keyQueryParamsList', param)">
                    {{ param }}
                    <button matChipRemove>
                      <mat-icon>cancel</mat-icon>
                    </button>
                  </mat-chip-row>
                }
              </mat-chip-grid>
              <input
                matInput
                placeholder="Add query param..."
                [matChipInputFor]="queryChipGrid"
                [matChipInputSeparatorKeyCodes]="separatorKeyCodes"
                [disabled]="!enabledControl().value"
                (matChipInputTokenEnd)="addListValue('keyQueryParamsList', $event.value, $event.chipInput)"
              />
            </mat-form-field>
          }

          <mat-form-field appearance="outline" class="form-field-full">
            <mat-label>Key headers</mat-label>
            <mat-chip-grid #headerChipGrid>
              @for (header of keyHeadersList(); track header) {
                <mat-chip-row (removed)="removeListValue('keyHeaders', header)">
                  {{ header }}
                  <button matChipRemove>
                    <mat-icon>cancel</mat-icon>
                  </button>
                </mat-chip-row>
              }
            </mat-chip-grid>
            <input
              matInput
              placeholder="Add header..."
              [matChipInputFor]="headerChipGrid"
              [matChipInputSeparatorKeyCodes]="separatorKeyCodes"
              [disabled]="!enabledControl().value"
              (matChipInputTokenEnd)="addListValue('keyHeaders', $event.value, $event.chipInput)"
            />
          </mat-form-field>

          @if (hasMutatingMethods()) {
            <div class="cache-warning">
              Caching mutating methods suppresses upstream side effects on cache
              hits. Only enable this for endpoints that are idempotent by body.
            </div>
          }
        </div>
      </mat-expansion-panel>
    </div>
  `,
  styles: `
    .cache-panel {
      width: 100%;
      --mat-expansion-container-background-color: var(--bg-card);
    }

    .cache-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-top: 4px;
    }

    .toggle-stack {
      display: flex;
      align-items: center;
      min-height: 56px;
    }

    .form-row {
      display: flex;
      gap: 12px;
    }

    .form-row-triple > * {
      flex: 1;
    }

    .form-field-half {
      flex: 1;
    }

    .form-field-full {
      width: 100%;
    }

    .cache-warning {
      border: 1px solid rgba(253, 100, 33, 0.35);
      border-radius: var(--radius);
      background: rgba(253, 100, 33, 0.12);
      color: var(--accent, #fd6421);
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.5;
    }
  `,
})
export class AdapterCacheStrategyFormComponent {
  readonly group = input.required<FormGroup>();
  readonly title = input("Cache");
  readonly subtitle = input("");

  readonly separatorKeyCodes = [ENTER, COMMA] as const;
  readonly httpMethods = HTTP_METHODS;

  enabledControl(): FormControl<boolean> {
    return this.group().get("enabled") as FormControl<boolean>;
  }

  queryParamsModeControl(): FormControl<string> {
    return this.group().get("queryParamsMode") as FormControl<string>;
  }

  keyHeadersList(): string[] {
    return this.readStringArrayControl("keyHeaders");
  }

  keyQueryParamsList(): string[] {
    return this.readStringArrayControl("keyQueryParamsList");
  }

  hasMutatingMethods(): boolean {
    const methodsControl = this.group().get("methods") as FormControl<HttpMethod[]>;
    const methods = methodsControl.value ?? [];
    for (let i = 0; i < methods.length; i++) {
      if (MUTATING_METHODS.has(methods[i]!)) {
        return true;
      }
    }
    return false;
  }

  addListValue(
    controlName: "keyHeaders" | "keyQueryParamsList",
    value: string,
    chipInput: { clear: () => void },
  ): void {
    const normalized = value.trim();
    if (!normalized) {
      chipInput.clear();
      return;
    }

    const control = this.group().get(controlName) as FormControl<string[]>;
    const current = control.value ?? [];
    if (!current.includes(normalized)) {
      control.setValue([...current, normalized]);
    }
    chipInput.clear();
  }

  removeListValue(
    controlName: "keyHeaders" | "keyQueryParamsList",
    value: string,
  ): void {
    const control = this.group().get(controlName) as FormControl<string[]>;
    const current = control.value ?? [];
    control.setValue(current.filter((entry) => entry !== value));
  }

  syncKeyBodyDefault(): void {
    const methodsControl = this.group().get("methods") as FormControl<HttpMethod[]>;
    const keyBodyControl = this.group().get("keyBody") as FormControl<boolean>;
    const methods = methodsControl.value ?? [];
    if (keyBodyControl.pristine && this.includesMutatingMethod(methods)) {
      keyBodyControl.setValue(true);
    }
  }

  private readStringArrayControl(
    controlName: "keyHeaders" | "keyQueryParamsList",
  ): string[] {
    const control = this.group().get(controlName) as FormControl<string[]>;
    return control.value ?? [];
  }

  private includesMutatingMethod(methods: readonly HttpMethod[]): boolean {
    for (let i = 0; i < methods.length; i++) {
      if (MUTATING_METHODS.has(methods[i]!)) {
        return true;
      }
    }
    return false;
  }
}
