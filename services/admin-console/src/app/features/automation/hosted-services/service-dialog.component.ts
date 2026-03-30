import { Component, inject, signal, type OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { RegistryService } from "../../../core/services/registry.service";
import type {
  ICreateService,
  IServiceDetail,
  IUpdateService,
} from "../../../core/models/registry.model";

export interface ServiceDialogData {
  service?: IServiceDetail;
}

export interface ServiceDialogResult {
  saved: boolean;
}

interface EnvVarRow {
  key: string;
  value: string;
}

@Component({
  selector: "app-service-dialog",
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>
      {{ isEdit ? "Edit Service" : "Register Service" }}
    </h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Name</mat-label>
        <input
          matInput
          [(ngModel)]="name"
          placeholder="my-service"
          [disabled]="isEdit"
          maxlength="63"
        />
        <mat-hint>
          Lowercase alphanumeric and hyphens only
        </mat-hint>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Image</mat-label>
        <input
          matInput
          [(ngModel)]="image"
          placeholder="registry.example.com/my-image:latest"
          maxlength="255"
        />
      </mat-form-field>

      <div class="field-row">
        <mat-form-field appearance="outline">
          <mat-label>Port</mat-label>
          <input
            matInput
            type="number"
            [(ngModel)]="port"
            placeholder="3000"
            min="1"
            max="65535"
          />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Min Scale</mat-label>
          <input
            matInput
            type="number"
            [(ngModel)]="minScale"
            placeholder="0"
            min="0"
            max="100"
          />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Max Scale</mat-label>
          <input
            matInput
            type="number"
            [(ngModel)]="maxScale"
            placeholder="10"
            min="1"
            max="1000"
          />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Concurrency</mat-label>
          <input
            matInput
            type="number"
            [(ngModel)]="concurrencyTarget"
            placeholder="100"
            min="1"
            max="10000"
          />
        </mat-form-field>
      </div>

      <div class="env-heading">
        <span>Environment Variables</span>
        <button
          mat-icon-button
          type="button"
          aria-label="Add variable"
          (click)="addEnvVar()"
        >
          <mat-icon>add_circle_outline</mat-icon>
        </button>
      </div>

      @for (row of envVars; track $index) {
        <div class="env-row">
          <mat-form-field appearance="outline" class="env-key">
            <mat-label>Key</mat-label>
            <input
              matInput
              [(ngModel)]="row.key"
              placeholder="VAR_NAME"
            />
          </mat-form-field>
          <mat-form-field appearance="outline" class="env-val">
            <mat-label>Value</mat-label>
            <input
              matInput
              [(ngModel)]="row.value"
              placeholder="value"
            />
          </mat-form-field>
          <button
            mat-icon-button
            color="warn"
            type="button"
            aria-label="Remove variable"
            (click)="removeEnvVar($index)"
          >
            <mat-icon>remove_circle_outline</mat-icon>
          </button>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">
        Cancel
      </button>
      <button
        mat-flat-button
        color="primary"
        type="button"
        [disabled]="saving() || !isValid()"
        (click)="save()"
      >
        {{
          saving()
            ? "Saving..."
            : isEdit
              ? "Update"
              : "Register"
        }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      min-width: 560px;
    }
    .full-width {
      width: 100%;
    }
    .field-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    .env-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      font-size: 14px;
      margin: 8px 0 4px;
    }
    .env-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .env-key {
      flex: 2;
    }
    .env-val {
      flex: 3;
    }
  `,
})
export class ServiceDialogComponent implements OnInit {
  private readonly registryService = inject(RegistryService);
  private readonly dialogRef =
    inject<
      MatDialogRef<ServiceDialogComponent, ServiceDialogResult>
    >(MatDialogRef);
  private readonly data =
    inject<ServiceDialogData>(MAT_DIALOG_DATA);

  readonly saving = signal(false);

  name = "";
  image = "";
  port: number | null = null;
  minScale: number | null = null;
  maxScale: number | null = null;
  concurrencyTarget: number | null = null;
  envVars: EnvVarRow[] = [];
  isEdit = false;

  ngOnInit(): void {
    const svc = this.data.service;
    if (svc) {
      this.isEdit = true;
      this.name = svc.name;
      this.image = svc.image;
      this.port = svc.port;
      this.minScale = svc.minScale;
      this.maxScale = svc.maxScale;
      this.concurrencyTarget = svc.concurrencyTarget;
      this.envVars = Object.entries(svc.envVars).map(
        ([key, value]) => ({ key, value }),
      );
    }
  }

  isValid(): boolean {
    if (!this.name.trim() || !this.image.trim()) {
      return false;
    }
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(this.name);
  }

  addEnvVar(): void {
    this.envVars = [...this.envVars, { key: "", value: "" }];
  }

  removeEnvVar(index: number): void {
    this.envVars = this.envVars.filter((_, i) => i !== index);
  }

  save(): void {
    const envVarsMap: Record<string, string> = {};
    for (const row of this.envVars) {
      const trimmedKey = row.key.trim();
      if (trimmedKey) {
        envVarsMap[trimmedKey] = row.value;
      }
    }

    this.saving.set(true);

    if (this.isEdit && this.data.service) {
      const dto: IUpdateService = {
        image: this.image.trim(),
        ...(this.port != null ? { port: this.port } : {}),
        ...(this.minScale != null
          ? { minScale: this.minScale }
          : {}),
        ...(this.maxScale != null
          ? { maxScale: this.maxScale }
          : {}),
        ...(this.concurrencyTarget != null
          ? { concurrencyTarget: this.concurrencyTarget }
          : {}),
        envVars: envVarsMap,
      };
      this.registryService.updateService(
        this.data.service.id,
        dto,
      );
      this.saving.set(false);
      this.dialogRef.close({ saved: true });
    } else {
      const dto: ICreateService = {
        name: this.name.trim(),
        image: this.image.trim(),
        ...(this.port != null ? { port: this.port } : {}),
        ...(this.minScale != null
          ? { minScale: this.minScale }
          : {}),
        ...(this.maxScale != null
          ? { maxScale: this.maxScale }
          : {}),
        ...(this.concurrencyTarget != null
          ? { concurrencyTarget: this.concurrencyTarget }
          : {}),
        envVars: envVarsMap,
      };
      this.registryService.createService(dto);
      this.saving.set(false);
      this.dialogRef.close({ saved: true });
    }
  }
}
