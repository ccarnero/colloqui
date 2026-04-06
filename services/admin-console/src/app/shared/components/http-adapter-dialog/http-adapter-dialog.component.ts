import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from "@angular/core";
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import {
  type AuthType,
  type IHttpAdapter,
  type IHttpAdapterContext,
  type IHttpAdapterDialogData,
  type IHttpAdapterDialogResult,
  type HttpMethod,
} from "../../models/http-adapter.model";
import { AdapterAuthConfigComponent } from "./adapter-auth-config.component";
import { AdapterEndpointConfigComponent } from "./adapter-endpoint-config.component";

@Component({
  selector: "app-http-adapter-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    AdapterAuthConfigComponent,
    AdapterEndpointConfigComponent,
  ],
  styleUrl: "./http-adapter-dialog.component.scss",
  template: `
    <div class="dialog-header">
      <div>
        <div class="dialog-title">{{ dialogTitle() }}</div>
        <div class="dialog-subtitle">
          Configure the HTTP adapter settings below
        </div>
      </div>
      <button
        type="button"
        class="btn btn-icon btn-secondary"
        aria-label="Close"
        (click)="dialogRef.close()"
      >
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <mat-dialog-content>
      <form [formGroup]="form" class="adapter-form">
        <div class="section-card">
          <div class="section-card-header">
            <div class="section-card-title">General</div>
          </div>
          <div class="section-card-body">
            @if (showContextSelector) {
              <mat-form-field appearance="outline" class="form-field-full">
                <mat-label>Scope</mat-label>
                <mat-select
                  [value]="contextSignal()"
                  (selectionChange)="contextSignal.set($event.value)"
                >
                  <mat-option value="internal">
                    Internal (inside cluster)
                  </mat-option>
                  <mat-option value="external">
                    External (third-party)
                  </mat-option>
                </mat-select>
              </mat-form-field>
            }
            <div class="form-row">
              <mat-form-field appearance="outline" class="form-field-half">
                <mat-label>Name</mat-label>
                <input matInput formControlName="name" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="form-field-half">
                <mat-label>Base URL</mat-label>
                <input
                  matInput
                  formControlName="baseUrl"
                  placeholder="{{ urlPlaceholder() }}"
                />
              </mat-form-field>
            </div>
          </div>
        </div>

        <app-adapter-auth-config
          [authForm]="authFormGroup"
          [authType]="authType()"
        />

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
            @for (hdr of headers.controls; track hdr; let i = $index) {
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
            @if (headers.length === 0) {
              <div class="empty-hint">No custom headers configured</div>
            }
          </div>
        </div>

        <app-adapter-endpoint-config [endpoints]="endpoints" />

        <div class="form-row-even">
          <div class="section-card">
            <div class="section-card-header">
              <div class="section-card-title">Reliability</div>
            </div>
            <div class="section-card-body">
              <div class="form-row form-row-triple">
                <mat-form-field appearance="outline">
                  <mat-label>Timeout (ms)</mat-label>
                  <input matInput type="number" formControlName="timeoutMs" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Max Retries</mat-label>
                  <input matInput type="number" formControlName="maxRetries" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Backoff (ms)</mat-label>
                  <input
                    matInput
                    type="number"
                    formControlName="retryBackoffMs"
                  />
                </mat-form-field>
              </div>
            </div>
          </div>

          <div class="section-card">
            <div class="section-card-header">
              <div class="section-card-title">Health Check</div>
            </div>
            <div class="section-card-body">
              <mat-form-field appearance="outline" class="form-field-full">
                <mat-label>Endpoint Path</mat-label>
                <input
                  matInput
                  formControlName="healthCheckPath"
                  placeholder="/health"
                />
              </mat-form-field>
            </div>
          </div>
        </div>
      </form>
    </mat-dialog-content>

    <div class="dialog-footer">
      <button
        type="button"
        class="btn btn-secondary"
        (click)="dialogRef.close()"
      >
        Cancel
      </button>
      <button
        type="button"
        class="btn btn-primary"
        [disabled]="form.invalid"
        (click)="submit()"
      >
        {{ data.mode === "create" ? "Create" : "Save Changes" }}
      </button>
    </div>
  `,
})
export class HttpAdapterDialogComponent {
  private readonly fb = inject(FormBuilder);
  readonly dialogRef = inject(
    MatDialogRef<HttpAdapterDialogComponent, IHttpAdapterDialogResult>,
  );
  readonly data = inject<IHttpAdapterDialogData>(MAT_DIALOG_DATA);

  readonly form = this.buildForm();

  readonly showContextSelector =
    this.data.mode === "create" && !this.data.context;

  readonly contextSignal = signal<IHttpAdapterContext>(
    this.data.context ?? "internal",
  );

  private readonly authTypeSignal = signal<AuthType>(
    this.data.adapter?.auth.type ?? "none",
  );

  readonly authType = this.authTypeSignal.asReadonly();

  readonly dialogTitle = computed(() => {
    const action = this.data.mode === "create" ? "Create" : "Edit";
    return `${action} Connector`;
  });

  readonly urlPlaceholder = computed(() =>
    this.contextSignal() === "internal"
      ? "http://svc.namespace.svc:8080"
      : "https://api.example.com",
  );

  get authFormGroup(): FormGroup {
    return this.form.get("auth") as FormGroup;
  }

  get headers(): FormArray {
    return this.form.get("headers") as FormArray;
  }

  headerGroup(index: number): FormGroup {
    return this.headers.at(index) as FormGroup;
  }

  addHeader(): void {
    this.headers.push(
      this.fb.group({
        key: ["", Validators.required],
        value: ["", Validators.required],
      }),
    );
  }

  removeHeader(index: number): void {
    this.headers.removeAt(index);
  }

  get endpoints(): FormArray {
    return this.form.get("endpoints") as FormArray;
  }

  submit(): void {
    if (this.form.invalid) {
      return;
    }

    const v = this.form.getRawValue();
    const authTypeVal = v.auth.type ?? "none";
    const adapter: IHttpAdapter = {
      name: v.name ?? "",
      baseUrl: v.baseUrl ?? "",
      auth: {
        type: authTypeVal,
        ...(authTypeVal === "api-key" && {
          apiKeyHeader: v.auth.apiKeyHeader ?? "X-API-Key",
          apiKey: v.auth.apiKey ?? "",
        }),
        ...(authTypeVal === "bearer" && {
          bearerToken: v.auth.bearerToken ?? "",
        }),
        ...(authTypeVal === "basic" && {
          basicUsername: v.auth.basicUsername ?? "",
          basicPassword: v.auth.basicPassword ?? "",
        }),
        ...(authTypeVal === "oauth2" && {
          oauth2ClientId: v.auth.oauth2ClientId ?? "",
          oauth2ClientSecret: v.auth.oauth2ClientSecret ?? "",
          oauth2TokenUrl: v.auth.oauth2TokenUrl ?? "",
        }),
      },
      headers: v.headers.map((h) => ({
        key: h.key ?? "",
        value: h.value ?? "",
      })),
      endpoints: v.endpoints.map((e) => ({
        label: e.label ?? "",
        method: (e.method ?? "GET") as HttpMethod,
        path: e.path ?? "",
      })),
      timeoutMs: v.timeoutMs ?? 5000,
      maxRetries: v.maxRetries ?? 3,
      retryBackoffMs: v.retryBackoffMs ?? 1000,
      healthCheckPath: v.healthCheckPath ?? "/health",
    };

    this.dialogRef.close({ adapter, context: this.contextSignal() });
  }

  private buildForm() {
    const a = this.data.adapter;

    const form = this.fb.group({
      name: [a?.name ?? "", Validators.required],
      baseUrl: [a?.baseUrl ?? "", Validators.required],
      auth: this.fb.group({
        type: [a?.auth.type ?? ("none" as AuthType)],
        apiKeyHeader: [a?.auth.apiKeyHeader ?? "X-API-Key"],
        apiKey: [a?.auth.apiKey ?? ""],
        bearerToken: [a?.auth.bearerToken ?? ""],
        basicUsername: [a?.auth.basicUsername ?? ""],
        basicPassword: [a?.auth.basicPassword ?? ""],
        oauth2ClientId: [a?.auth.oauth2ClientId ?? ""],
        oauth2ClientSecret: [a?.auth.oauth2ClientSecret ?? ""],
        oauth2TokenUrl: [a?.auth.oauth2TokenUrl ?? ""],
      }),
      headers: this.fb.array(
        (a?.headers ?? []).map((h) =>
          this.fb.group({
            key: [h.key, Validators.required],
            value: [h.value, Validators.required],
          }),
        ),
      ),
      endpoints: this.fb.array(
        (a?.endpoints ?? []).map((e) =>
          this.fb.group({
            label: [e.label, Validators.required],
            method: [e.method as HttpMethod, Validators.required],
            path: [e.path, Validators.required],
          }),
        ),
      ),
      timeoutMs: [
        a?.timeoutMs ?? 5000,
        [Validators.required, Validators.min(0)],
      ],
      maxRetries: [
        a?.maxRetries ?? 3,
        [Validators.required, Validators.min(0)],
      ],
      retryBackoffMs: [
        a?.retryBackoffMs ?? 1000,
        [Validators.required, Validators.min(0)],
      ],
      healthCheckPath: [a?.healthCheckPath ?? "/health"],
    });

    form.get("auth.type")?.valueChanges.subscribe((type) => {
      if (type) {
        this.authTypeSignal.set(type);
      }
    });

    return form;
  }
}
