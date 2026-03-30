import { Component, computed, inject, signal } from "@angular/core";
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
  type HttpAdapter,
  type HttpAdapterDialogData,
  type HttpMethod,
} from "../../models/http-adapter.model";

const HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

const AUTH_TYPE_LABELS: ReadonlyMap<AuthType, string> = new Map([
  ["none", "None"],
  ["api-key", "API Key"],
  ["bearer", "Bearer Token"],
  ["basic", "Basic Auth"],
  ["oauth2", "OAuth2 (Client Credentials)"],
]);

@Component({
  selector: "app-http-adapter-dialog",
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
  ],
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

        <div class="section-card" formGroupName="auth">
          <div class="section-card-header">
            <div class="section-card-title">Authentication</div>
          </div>
          <div class="section-card-body">
            <mat-form-field appearance="outline" class="form-field-full">
              <mat-label>Auth Type</mat-label>
              <mat-select formControlName="type">
                @for (opt of authOptions; track opt.value) {
                  <mat-option [value]="opt.value">
                    {{ opt.label }}
                  </mat-option>
                }
              </mat-select>
            </mat-form-field>

            @switch (authType()) {
              @case ("api-key") {
                <div class="form-row">
                  <mat-form-field
                    appearance="outline"
                    class="form-field-half"
                  >
                    <mat-label>Header Name</mat-label>
                    <input
                      matInput
                      formControlName="apiKeyHeader"
                      placeholder="X-API-Key"
                    />
                  </mat-form-field>
                  <mat-form-field
                    appearance="outline"
                    class="form-field-half"
                  >
                    <mat-label>API Key</mat-label>
                    <input
                      matInput
                      formControlName="apiKey"
                      type="password"
                    />
                  </mat-form-field>
                </div>
              }
              @case ("bearer") {
                <mat-form-field
                  appearance="outline"
                  class="form-field-full"
                >
                  <mat-label>Bearer Token</mat-label>
                  <input
                    matInput
                    formControlName="bearerToken"
                    type="password"
                  />
                </mat-form-field>
              }
              @case ("basic") {
                <div class="form-row">
                  <mat-form-field
                    appearance="outline"
                    class="form-field-half"
                  >
                    <mat-label>Username</mat-label>
                    <input matInput formControlName="basicUsername" />
                  </mat-form-field>
                  <mat-form-field
                    appearance="outline"
                    class="form-field-half"
                  >
                    <mat-label>Password</mat-label>
                    <input
                      matInput
                      formControlName="basicPassword"
                      type="password"
                    />
                  </mat-form-field>
                </div>
              }
              @case ("oauth2") {
                <div class="form-row">
                  <mat-form-field
                    appearance="outline"
                    class="form-field-half"
                  >
                    <mat-label>Client ID</mat-label>
                    <input matInput formControlName="oauth2ClientId" />
                  </mat-form-field>
                  <mat-form-field
                    appearance="outline"
                    class="form-field-half"
                  >
                    <mat-label>Client Secret</mat-label>
                    <input
                      matInput
                      formControlName="oauth2ClientSecret"
                      type="password"
                    />
                  </mat-form-field>
                </div>
                <mat-form-field
                  appearance="outline"
                  class="form-field-full"
                >
                  <mat-label>Token URL</mat-label>
                  <input
                    matInput
                    formControlName="oauth2TokenUrl"
                    placeholder="https://auth.example.com/oauth/token"
                  />
                </mat-form-field>
              }
            }
          </div>
        </div>

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
              <div
                class="form-row list-row"
                [formGroup]="headerGroup(i)"
              >
                <mat-form-field
                  appearance="outline"
                  class="form-field-half"
                >
                  <mat-label>Key</mat-label>
                  <input matInput formControlName="key" />
                </mat-form-field>
                <mat-form-field
                  appearance="outline"
                  class="form-field-half"
                >
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
            @for (ep of endpoints.controls; track ep; let i = $index) {
              <div
                class="form-row list-row"
                [formGroup]="endpointGroup(i)"
              >
                <mat-form-field
                  appearance="outline"
                  class="form-field-method"
                >
                  <mat-label>Method</mat-label>
                  <mat-select formControlName="method">
                    @for (m of httpMethods; track m) {
                      <mat-option [value]="m">{{ m }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field
                  appearance="outline"
                  class="form-field-path"
                >
                  <mat-label>Path</mat-label>
                  <input
                    matInput
                    formControlName="path"
                    placeholder="/api/resource"
                  />
                </mat-form-field>
                <mat-form-field
                  appearance="outline"
                  class="form-field-label"
                >
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
            }
            @if (endpoints.length === 0) {
              <div class="empty-hint">No endpoints configured</div>
            }
          </div>
        </div>

        <div class="form-row-even">
          <div class="section-card">
            <div class="section-card-header">
              <div class="section-card-title">Reliability</div>
            </div>
            <div class="section-card-body">
              <div class="form-row form-row-triple">
                <mat-form-field appearance="outline">
                  <mat-label>Timeout (ms)</mat-label>
                  <input
                    matInput
                    type="number"
                    formControlName="timeoutMs"
                  />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Max Retries</mat-label>
                  <input
                    matInput
                    type="number"
                    formControlName="maxRetries"
                  />
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
              <mat-form-field
                appearance="outline"
                class="form-field-full"
              >
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
  styles: `
    :host {
      display: block;
      font-size: 13px;
    }

    .dialog-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 16px 24px 10px;
      gap: 12px;
    }

    .dialog-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.2px;
      color: var(--text);
    }

    .dialog-subtitle {
      font-size: 11px;
      color: var(--text3);
      margin-top: 2px;
    }

    .dialog-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 24px 16px;
      border-top: 1px solid var(--border);
    }

    .adapter-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .section-card-title {
      font-size: 12px;
    }

    .section-card-header {
      padding: 10px 14px;
    }

    .section-card-body {
      padding: 14px;
    }

    .form-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .form-row-triple {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
    }

    .form-row-even {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .form-row-even .section-card {
      margin-bottom: 0;
    }

    .form-field-half {
      flex: 1;
    }

    .form-field-full {
      width: 100%;
    }

    .list-row {
      margin-bottom: 4px;
      align-items: center;
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
export class HttpAdapterDialogComponent {
  private readonly fb = inject(FormBuilder);
  readonly dialogRef = inject(
    MatDialogRef<HttpAdapterDialogComponent>,
  );
  readonly data = inject<HttpAdapterDialogData>(MAT_DIALOG_DATA);

  readonly authOptions = [...AUTH_TYPE_LABELS.entries()].map(
    ([value, label]) => ({ value, label }),
  );

  readonly httpMethods = HTTP_METHODS;

  readonly form = this.buildForm();

  private readonly authTypeSignal = signal<AuthType>(
    this.data.adapter?.auth.type ?? "none",
  );

  readonly authType = this.authTypeSignal.asReadonly();

  readonly dialogTitle = computed(() => {
    const action = this.data.mode === "create" ? "Create" : "Edit";
    const ctx =
      this.data.context === "internal"
        ? "Internal Source"
        : "External Source";
    return `${action} ${ctx}`;
  });

  readonly urlPlaceholder = computed(() =>
    this.data.context === "internal"
      ? "http://svc.namespace.svc:8080"
      : "https://api.example.com",
  );

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

  endpointGroup(index: number): FormGroup {
    return this.endpoints.at(index) as FormGroup;
  }

  addEndpoint(): void {
    this.endpoints.push(
      this.fb.group({
        label: ["", Validators.required],
        method: ["GET" as HttpMethod, Validators.required],
        path: ["", Validators.required],
      }),
    );
  }

  removeEndpoint(index: number): void {
    this.endpoints.removeAt(index);
  }

  submit(): void {
    if (this.form.invalid) {
      return;
    }

    const v = this.form.getRawValue();
    const authType = v.auth.type ?? "none";
    const adapter: HttpAdapter = {
      name: v.name ?? "",
      baseUrl: v.baseUrl ?? "",
      auth: {
        type: authType,
        ...(authType === "api-key" && {
          apiKeyHeader: v.auth.apiKeyHeader ?? "X-API-Key",
          apiKey: v.auth.apiKey ?? "",
        }),
        ...(authType === "bearer" && {
          bearerToken: v.auth.bearerToken ?? "",
        }),
        ...(authType === "basic" && {
          basicUsername: v.auth.basicUsername ?? "",
          basicPassword: v.auth.basicPassword ?? "",
        }),
        ...(authType === "oauth2" && {
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

    this.dialogRef.close(adapter);
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
      timeoutMs: [a?.timeoutMs ?? 5000, [Validators.required, Validators.min(0)]],
      maxRetries: [a?.maxRetries ?? 3, [Validators.required, Validators.min(0)]],
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
