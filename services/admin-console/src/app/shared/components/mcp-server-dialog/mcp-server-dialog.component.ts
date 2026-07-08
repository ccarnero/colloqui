import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from "@angular/core";
import {
  type FormArray,
  FormBuilder,
  type FormGroup,
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
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSelectModule } from "@angular/material/select";
import type {
  IMcpTestConnectionResult,
  McpServerAuthType,
  McpServerScope,
} from "../../../core/models/agent.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { McpAuthConfigComponent } from "./mcp-auth-config.component";
import { McpHeadersConfigComponent } from "./mcp-headers-config.component";
import type {
  IMcpServerDialogData,
  IMcpServerDialogResult,
} from "./mcp-server-dialog.types";
import { mcpScopeOptions } from "./mcp-server-dialog.types";

/**
 * Create/Edit dialog for MCP servers — real `MatDialog`, replacing the old
 * hand-rolled `.modal-backdrop` in `mcp-servers-page.component.ts`
 * (mcp-connections.md §6.4).
 *
 * Deliberately has NO Tools/Endpoints section and NO Cache section — tools
 * are discovered live from the server (§2.4), never defined here, and
 * MCP calls have no cache-strategy convention (§0.4).
 */
@Component({
  selector: "app-mcp-server-dialog",
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
    MatProgressSpinnerModule,
    McpAuthConfigComponent,
    McpHeadersConfigComponent,
  ],
  styleUrl: "./mcp-server-dialog.component.scss",
  template: `
    <div class="dialog-header">
      <div>
        <div class="dialog-title">
          {{ data.mode === "create" ? "Add" : "Edit" }} MCP Server
        </div>
        <div class="dialog-subtitle">
          Configure the Model Context Protocol server connection below
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
            <strong>Synced server.</strong>
            This MCP server is mirrored from <code>{{ managedBy }}</code>.
            <strong>Name</strong>, <strong>URL</strong> and
            <strong>Transport</strong> are managed automatically and are
            read-only here. You can still edit auth, headers, and the
            enabled toggle.
          </div>
        </div>
      }

      <form [formGroup]="form" class="mcp-form">
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
                <mat-label>Transport Type</mat-label>
                <mat-select formControlName="transport_type">
                  <mat-option value="http">HTTP</mat-option>
                  <mat-option value="sse">SSE (Server-Sent Events)</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
            <mat-form-field appearance="outline" class="form-field-full">
              <mat-label>URL</mat-label>
              <input
                matInput
                formControlName="url"
                placeholder="https://mcp-server.example.com/sse"
              />
            </mat-form-field>
            <mat-form-field appearance="outline" class="form-field-full">
              <mat-label>Description</mat-label>
              <input
                matInput
                formControlName="description"
                placeholder="Optional description"
              />
            </mat-form-field>
            <mat-form-field appearance="outline" class="form-field-half">
              <mat-label>Scope</mat-label>
              <mat-select formControlName="scope">
                @for (option of scopeOptions; track option.value) {
                  <mat-option [value]="option.value">{{
                    option.label
                  }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <label class="form-check">
              <input type="checkbox" formControlName="enabled" />
              <span>Enable this server</span>
            </label>
          </div>
        </div>

        <app-mcp-auth-config [authForm]="authFormGroup" [authType]="authType()" />

        <app-mcp-headers-config [headers]="headers" />

        <div class="section-card">
          <div class="section-card-header">
            <div class="section-card-title">Test Connection</div>
          </div>
          <div class="section-card-body">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              [disabled]="testing() || data.mode === 'create'"
              [title]="
                data.mode === 'create'
                  ? 'Save the server first, then test the connection'
                  : ''
              "
              (click)="testConnection()"
            >
              @if (testing()) {
                <mat-spinner diameter="14" />
              } @else {
                <mat-icon class="btn-add-icon">bolt</mat-icon>
              }
              Test Connection
            </button>
            @if (data.mode === "create") {
              <div class="empty-hint">
                Test Connection is available after the server is saved.
              </div>
            }
            @if (testResult(); as result) {
              @if (result.success) {
                <div class="test-result test-result-success">
                  <mat-icon>check_circle</mat-icon>
                  Connected in {{ result.latencyMs }}ms
                  @if (result.toolCount !== undefined) {
                    · {{ result.toolCount }} tool(s) found
                  }
                </div>
              } @else {
                <div class="test-result test-result-error">
                  <mat-icon>error</mat-icon>
                  {{ result.error ?? "Connection failed." }}
                </div>
              }
            }
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
export class McpServerDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly agentAdminService = inject(AgentAdminService);
  readonly dialogRef = inject(
    MatDialogRef<McpServerDialogComponent, IMcpServerDialogResult>
  );
  readonly data = inject<IMcpServerDialogData>(MAT_DIALOG_DATA);

  readonly form = this.buildForm();

  readonly scopeOptions = mcpScopeOptions();

  /** Owner of a synced server, or null for operator-owned ones. */
  readonly managedBy = this.data.server?.managed_by ?? null;
  readonly isManaged = this.managedBy !== null;

  private readonly authTypeSignal = signal<McpServerAuthType>(
    this.data.server?.auth_type ?? "none"
  );
  readonly authType = this.authTypeSignal.asReadonly();

  readonly testing = signal(false);
  readonly testResult = signal<IMcpTestConnectionResult | null>(null);

  get authFormGroup(): FormGroup {
    return this.form.get("auth") as FormGroup;
  }

  get headers(): FormArray {
    return this.form.get("headers") as FormArray;
  }

  testConnection(): void {
    const id = this.data.server?.id;
    if (!id) {
      return;
    }
    this.testing.set(true);
    this.testResult.set(null);
    this.agentAdminService.testMcpServer(id).subscribe({
      next: (result) => {
        this.testResult.set(result);
        this.testing.set(false);
      },
      error: () => {
        this.testResult.set({
          success: false,
          latencyMs: 0,
          error: "Couldn't reach the test-connection endpoint.",
        });
        this.testing.set(false);
      },
    });
  }

  submit(): void {
    if (this.form.invalid) {
      return;
    }

    const v = this.form.getRawValue();
    const authTypeVal = v.auth.type ?? "none";
    const headerValues = v.headers as Array<{ key: string; value: string }>;

    const headers = headerValues.reduce<Record<string, string>>((acc, h) => {
      if (h.key) {
        acc[h.key] = h.value ?? "";
      }
      return acc;
    }, {});

    let authConfig: Record<string, unknown> | undefined;
    if (authTypeVal === "api-key") {
      authConfig = {
        headerName: v.auth.headerName || "X-Api-Key",
        key: v.auth.key ?? "",
      };
    } else if (authTypeVal === "bearer") {
      authConfig = { token: v.auth.token ?? "" };
    } else if (authTypeVal === "basic") {
      authConfig = {
        username: v.auth.username ?? "",
        password: v.auth.password ?? "",
      };
    }

    const result: IMcpServerDialogResult = {
      name: v.name ?? "",
      description: v.description || undefined,
      transport_type: v.transport_type ?? "http",
      url: v.url ?? "",
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      authType: authTypeVal,
      authConfig,
      enabled: v.enabled ?? true,
      scope: (v.scope as McpServerScope) ?? "external",
    };

    this.dialogRef.close(result);
  }

  private buildForm() {
    const s = this.data.server;
    const authConfig = (s?.auth_config ?? {}) as Record<string, unknown>;

    const form = this.fb.group({
      name: [s?.name ?? "", Validators.required],
      description: [s?.description ?? ""],
      transport_type: [s?.transport_type ?? ("http" as "http" | "sse")],
      url: [s?.url ?? "", Validators.required],
      headers: this.fb.array(
        Object.entries(s?.headers ?? {}).map(([key, value]) =>
          this.fb.group({
            key: [key, Validators.required],
            value: [value, Validators.required],
          })
        )
      ),
      auth: this.fb.group({
        type: [s?.auth_type ?? ("none" as McpServerAuthType)],
        headerName: [(authConfig["headerName"] as string) ?? "X-Api-Key"],
        key: [(authConfig["key"] as string) ?? ""],
        token: [(authConfig["token"] as string) ?? ""],
        username: [(authConfig["username"] as string) ?? ""],
        password: [(authConfig["password"] as string) ?? ""],
      }),
      enabled: [s?.enabled ?? true],
      scope: [s?.scope ?? ("external" as McpServerScope)],
    });

    form.get("auth.type")?.valueChanges.subscribe((type) => {
      if (type) {
        this.authTypeSignal.set(type);
      }
    });

    // Registry-owned fields are read-only for synced servers (§2.3).
    if (this.isManaged) {
      form.get("name")?.disable();
      form.get("url")?.disable();
      form.get("transport_type")?.disable();
    }

    return form;
  }
}
