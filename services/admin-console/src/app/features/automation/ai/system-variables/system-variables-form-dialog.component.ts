import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import {
  type ISystemVariable,
  type SystemVariableType,
  SystemVariablesService,
} from "../../../../core/services/system-variables.service";

export interface ISystemVariableFormResult {
  name: string;
  type: SystemVariableType;
  value: unknown;
  label: string;
  description: string;
}

export interface ISystemVariableDialogData {
  variable?: ISystemVariable;
}

const TYPE_OPTIONS: { value: SystemVariableType; label: string }[] = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "json", label: "JSON" },
  { value: "array", label: "Array" },
  { value: "secret", label: "Secret" },
];

@Component({
  selector: "app-system-variables-form-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ isEdit ? "Edit Variable" : "New Variable" }}</h2>

    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Name</mat-label>
        <input matInput [(ngModel)]="name" placeholder="Variable name" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Type</mat-label>
        <mat-select [(ngModel)]="type" (selectionChange)="onTypeChange()">
          @for (opt of typeOptions; track opt.value) {
            <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      @switch (type) {
        @case ("string") {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Value</mat-label>
            <input matInput [(ngModel)]="stringValue" placeholder="String value" />
          </mat-form-field>
        }
        @case ("number") {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Value</mat-label>
            <input matInput type="number" [(ngModel)]="numberValue" placeholder="Number value" />
          </mat-form-field>
        }
        @case ("boolean") {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Value</mat-label>
            <mat-select [(ngModel)]="booleanValue">
              <mat-option [value]="true">true</mat-option>
              <mat-option [value]="false">false</mat-option>
            </mat-select>
          </mat-form-field>
        }
        @case ("json") {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Value (JSON)</mat-label>
            <textarea
              matInput
              [(ngModel)]="stringValue"
              rows="4"
              placeholder='{"key": "value"}'
            ></textarea>
          </mat-form-field>
        }
        @case ("array") {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Value (JSON Array)</mat-label>
            <textarea
              matInput
              [(ngModel)]="stringValue"
              rows="4"
              placeholder='["item1", "item2"]'
            ></textarea>
          </mat-form-field>
        }
        @case ("secret") {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Value</mat-label>
            <input matInput type="password" [(ngModel)]="stringValue" placeholder="Secret value" />
          </mat-form-field>
        }
      }

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Label (optional)</mat-label>
        <input matInput [(ngModel)]="label" placeholder="Display label" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Description (optional)</mat-label>
        <textarea
          matInput
          [(ngModel)]="description"
          rows="3"
          placeholder="Variable description"
        ></textarea>
      </mat-form-field>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancel</button>
      <button
        mat-flat-button
        color="primary"
        type="button"
        [disabled]="saving() || !name.trim()"
        (click)="save()"
      >
        {{ saving() ? "Saving..." : isEdit ? "Update" : "Create" }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      min-width: 420px;
      max-width: 560px;
    }
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .full-width {
      width: 100%;
    }
  `,
})
export class SystemVariablesFormDialogComponent {
  private readonly service = inject(SystemVariablesService);
  private readonly dialogRef = inject<
    MatDialogRef<
      SystemVariablesFormDialogComponent,
      ISystemVariableFormResult | undefined
    >
  >(MatDialogRef);
  private readonly data = inject<ISystemVariableDialogData>(MAT_DIALOG_DATA);

  readonly typeOptions = TYPE_OPTIONS;
  readonly saving = signal(false);
  readonly isEdit: boolean;

  name = "";
  type: SystemVariableType = "string";
  stringValue = "";
  numberValue: number | null = null;
  booleanValue = false;
  label = "";
  description = "";

  constructor() {
    const variable = this.data?.variable;
    this.isEdit = !!variable;
    if (variable) {
      this.name = variable.name;
      this.type = variable.type;
      this.label = variable.label ?? "";
      this.description = variable.description ?? "";
      this.setFormValue(variable.value, variable.type);
    }
  }

  onTypeChange(): void {
    this.stringValue = "";
    this.numberValue = null;
    this.booleanValue = false;
  }

  private setFormValue(value: unknown, type: SystemVariableType): void {
    switch (type) {
      case "number":
        this.numberValue = value as number | null;
        break;
      case "boolean":
        this.booleanValue = value as boolean;
        break;
      default:
        this.stringValue =
          typeof value === "string"
            ? value
            : JSON.stringify(value ?? "", null, 2);
        break;
    }
  }

  private getFormValue(): unknown {
    switch (this.type) {
      case "number":
        return this.numberValue;
      case "boolean":
        return this.booleanValue;
      default:
        return this.stringValue;
    }
  }

  getResult(): ISystemVariableFormResult {
    return {
      name: this.name.trim(),
      type: this.type,
      value: this.getFormValue(),
      label: this.label.trim(),
      description: this.description.trim(),
    };
  }

  async save(): Promise<void> {
    const result = this.getResult();
    this.saving.set(true);

    try {
      if (this.isEdit && this.data?.variable) {
        await this.service
          .update(this.data.variable.id, result)
          .toPromise();
      } else {
        await this.service.create(result).toPromise();
      }
      this.dialogRef.close(result);
    } catch {
      this.saving.set(false);
    }
  }
}
