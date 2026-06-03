import {
  ChangeDetectionStrategy,
  Component,
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
import { MatChipsModule } from "@angular/material/chips";
import { COMMA, ENTER } from "@angular/cdk/keycodes";
import {
  type AuthType,
  type IHttpAdapter,
  type IHttpAdapterCacheStrategy,
  type IHttpAdapterContext,
  type IHttpAdapterDialogData,
  type IHttpAdapterDialogResult,
  type HttpMethod,
} from "../../models/http-adapter.model";
import { AdapterAuthConfigComponent } from "./adapter-auth-config.component";
import { AdapterCacheStrategyFormComponent } from "./adapter-cache-strategy-form.component";
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
    MatChipsModule,
    MatIconModule,
    AdapterAuthConfigComponent,
    AdapterCacheStrategyFormComponent,
    AdapterEndpointConfigComponent,
  ],
  styleUrl: "./http-adapter-dialog.component.scss",
  template: `
    <div class="dialog-header">
      <div>
        <div class="dialog-title">
          {{ data.mode === "create" ? "Create" : "Edit" }} Connector
        </div>
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
      @if (isManaged) {
        <div class="managed-banner" role="note">
          <mat-icon class="managed-banner-icon">sync</mat-icon>
          <div>
            <strong>Synced connector.</strong>
            This connector is mirrored from <code>{{ managedBy }}</code>.
            <strong>Name</strong>, <strong>Base URL</strong> and
            <strong>Health Check</strong> are managed automatically and are
            read-only here. You can still edit auth, headers, caching,
            reliability, tags and endpoints.
          </div>
        </div>
      }

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
                  [placeholder]="
                    contextSignal() === 'internal'
                      ? 'http://svc.namespace.svc:8080'
                      : 'https://api.example.com'
                  "
                />
              </mat-form-field>
            </div>
          </div>
        </div>

        <div class="section-card">
          <div class="section-card-header">
            <div class="section-card-title">Tags</div>
          </div>
          <div class="section-card-body">
            <mat-form-field appearance="outline" class="form-field-full">
              <mat-label>Tags</mat-label>
              <mat-chip-grid #chipGrid>
                @for (tag of tags(); track tag) {
                  <mat-chip-row (removed)="removeTag(tag)">
                    {{ tag }}
                    <button matChipRemove>
                      <mat-icon>cancel</mat-icon>
                    </button>
                  </mat-chip-row>
                }
              </mat-chip-grid>
              <input
                matInput
                placeholder="Add tag..."
                [matChipInputFor]="chipGrid"
                [matChipInputSeparatorKeyCodes]="separatorKeyCodes"
                (matChipInputTokenEnd)="addTag($event)"
              />
            </mat-form-field>
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

        <div class="section-card">
          <div class="section-card-header">
            <div class="section-card-title">Default Cache</div>
          </div>
          <div class="section-card-body">
            <app-adapter-cache-strategy-form
              [group]="defaultCacheFormGroup"
              [title]="'Default cache'"
              [subtitle]="'Default adapter cache strategy'"
            />
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

  readonly separatorKeyCodes = [ENTER, COMMA] as const;

  readonly showContextSelector =
    this.data.mode === "create" && !this.data.context;

  readonly contextSignal = signal<IHttpAdapterContext>(
    this.data.context ?? "internal",
  );

  readonly tags = signal<string[]>(this.data.adapter?.tags ?? []);

  /** Owner of a synced connector, or null for operator-owned ones. */
  readonly managedBy = this.data.adapter?.managedBy ?? null;
  readonly isManaged = this.managedBy !== null;

  private readonly authTypeSignal = signal<AuthType>(
    this.data.adapter?.auth.type ?? "none",
  );

  readonly authType = this.authTypeSignal.asReadonly();

  get authFormGroup(): FormGroup {
    return this.form.get("auth") as FormGroup;
  }

  get headers(): FormArray {
    return this.form.get("headers") as FormArray;
  }

  get defaultCacheFormGroup(): FormGroup {
    return this.form.get("defaultCache") as FormGroup;
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

  addTag(event: { value: string; chipInput: { clear: () => void } }): void {
    const value = (event.value ?? "").trim().toLowerCase();
    if (value && !this.tags().includes(value)) {
      this.tags.update((t) => [...t, value]);
    }
    event.chipInput.clear();
  }

  removeTag(tag: string): void {
    this.tags.update((t) => t.filter((v) => v !== tag));
  }

  submit(): void {
    if (this.form.invalid) {
      return;
    }

    const v = this.form.getRawValue();
    const authTypeVal = v.auth.type ?? "none";
    const endpointValues = v.endpoints as Array<Record<string, unknown>>;

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
      defaultCache: this.serializeCacheStrategyFormValue(v.defaultCache),
      endpoints: endpointValues.map((endpointValue) => ({
        id: (endpointValue["id"] as string | null | undefined) ?? undefined,
        label: (endpointValue["label"] as string | undefined) ?? "",
        method: ((endpointValue["method"] as HttpMethod | undefined) ?? "GET") as HttpMethod,
        path: (endpointValue["path"] as string | undefined) ?? "",
        cache: this.serializeCacheStrategyFormValue(
          endpointValue["cache"] as
            | {
                enabled?: boolean;
                ttlSeconds?: number;
                methods?: HttpMethod[];
                keyBody?: boolean;
                keyHeaders?: string[];
                queryParamsMode?: string;
                keyQueryParamsList?: string[];
              }
            | undefined,
        ),
      })),
      timeoutMs: v.timeoutMs ?? 5000,
      maxRetries: v.maxRetries ?? 3,
      retryBackoffMs: v.retryBackoffMs ?? 1000,
      healthCheckPath: v.healthCheckPath ?? "/health",
      tags: this.tags(),
      isEncrypted: false,
    };

    this.dialogRef.close({
      adapter,
      context: this.contextSignal(),
    });
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
      defaultCache: this.createCacheFormGroup(a?.defaultCache),
      endpoints: this.fb.array(
        (a?.endpoints ?? []).map((e) => this.createEndpointGroup(e)),
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

    // Registry-owned fields are read-only for synced connectors. Disabled
    // controls are excluded from validation but still returned by
    // getRawValue(), and the caller omits them from the update payload.
    if (this.data.adapter?.managedBy) {
      form.get("name")?.disable();
      form.get("baseUrl")?.disable();
      form.get("healthCheckPath")?.disable();
    }

    return form;
  }

  private createEndpointGroup(endpoint?: IHttpAdapter["endpoints"][number]): FormGroup {
    return this.fb.group({
      id: [endpoint?.id ?? null],
      label: [endpoint?.label ?? "", Validators.required],
      method: [endpoint?.method ?? ("GET" as HttpMethod), Validators.required],
      path: [endpoint?.path ?? "", Validators.required],
      cache: this.createCacheFormGroup(endpoint?.cache, endpoint?.method),
    });
  }

  private createCacheFormGroup(
    strategy?: IHttpAdapterCacheStrategy,
    method?: HttpMethod,
  ): FormGroup {
    const selectedMethod = method ?? strategy?.methods?.[0] ?? "GET";
    const queryParamsMode = Array.isArray(strategy?.keyQueryParams)
      ? "custom"
      : "all";
    const keyBodyDefault =
      selectedMethod === "POST" ||
      selectedMethod === "PUT" ||
      selectedMethod === "PATCH" ||
      selectedMethod === "DELETE";

    return this.fb.group({
      enabled: [strategy?.enabled ?? false],
      ttlSeconds: [
        strategy?.ttlSeconds ?? 60,
        [Validators.required, Validators.min(1)],
      ],
      methods: [
        strategy?.methods ?? (["GET", "HEAD"] as HttpMethod[]),
        Validators.required,
      ],
      keyBody: [strategy?.keyBody ?? keyBodyDefault],
      keyHeaders: [strategy?.keyHeaders ?? []],
      queryParamsMode: [queryParamsMode],
      keyQueryParamsList: [
        Array.isArray(strategy?.keyQueryParams) ? strategy.keyQueryParams : [],
      ],
    });
  }

  private serializeCacheStrategyFormValue(
    value:
      | {
          enabled?: boolean;
          ttlSeconds?: number;
          methods?: HttpMethod[];
          keyBody?: boolean;
          keyHeaders?: string[];
          queryParamsMode?: string;
          keyQueryParamsList?: string[];
        }
      | undefined,
  ): IHttpAdapterCacheStrategy | undefined {
    if (!value?.enabled) {
      return undefined;
    }

    return {
      enabled: true,
      ttlSeconds: Math.max(1, value.ttlSeconds ?? 60),
      methods: value.methods ?? ["GET", "HEAD"],
      keyBody: value.keyBody ?? false,
      keyHeaders: value.keyHeaders ?? [],
      keyQueryParams:
        value.queryParamsMode === "custom"
          ? (value.keyQueryParamsList ?? [])
          : "all",
    };
  }
}
