import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  type OnInit,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import {
  EWorkflowNodeType,
  type IWorkflowNode,
} from "../../../domain/workflow-node.types";
import { ChannelAdminService } from "../../../../../../core/services/channel-admin.service";
import type { IChannelAccount } from "../../../../../../core/models/channel-account.model";
import {
  HttpAdapterService,
  type IAdapterDto,
  type IAdapterEndpointDto,
} from "../../../../../../core/services/http-adapter.service";
import { RegistryService } from "../../../../../../core/services/registry.service";
import { YoizenclawAdminService } from "../../../../../../core/services/yoizenclaw-admin.service";
import type { IYoizenclawAgent } from "../../../../../../core/models/yoizenclaw.model";

@Component({
  selector: "app-workflow-node-config",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    @if (node(); as n) {
      <div class="config-panel">
        <div class="config-header">
          <mat-icon>{{ n.icon }}</mat-icon>
          <span class="config-title">{{ n.name }}</span>
          <button
            mat-icon-button
            type="button"
            (click)="close.emit()"
          >
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <div class="config-body">
          <mat-form-field appearance="outline" class="config-field">
            <mat-label>Name</mat-label>
            <input
              matInput
              [ngModel]="n.name"
              (ngModelChange)="updateField('name', $event)"
            />
          </mat-form-field>

          @switch (n.type) {
            @case (types.CHANNEL) {
              <mat-form-field
                appearance="outline"
                class="config-field"
              >
                <mat-label>Direction</mat-label>
                <mat-select
                  [ngModel]="n.configuration['direction']"
                  (ngModelChange)="
                    updateConfig('direction', $event)
                  "
                >
                  <mat-option value="inbound">
                    Inbound (receive)
                  </mat-option>
                  <mat-option value="outbound">
                    Outbound (send)
                  </mat-option>
                </mat-select>
              </mat-form-field>

              @if (n.configuration['direction'] === 'inbound') {
                <mat-form-field
                  appearance="outline"
                  class="config-field"
                >
                  <mat-label>Mode</mat-label>
                  <mat-select
                    [ngModel]="n.configuration['mode']"
                    (ngModelChange)="
                      updateConfig('mode', $event)
                    "
                  >
                    <mat-option value="shared">
                      Shared
                    </mat-option>
                    <mat-option value="exclusive">
                      Exclusive
                    </mat-option>
                  </mat-select>
                </mat-form-field>

                <mat-form-field
                  appearance="outline"
                  class="config-field"
                >
                  <mat-label>Channel Accounts</mat-label>
                  <mat-select
                    multiple
                    [ngModel]="n.configuration['accountIds']"
                    (ngModelChange)="
                      updateConfig('accountIds', $event)
                    "
                  >
                    @for (
                      acc of channelAccounts();
                      track acc.id
                    ) {
                      <mat-option [value]="acc.id">
                        {{ acc.name }} ({{ acc.channel }})
                      </mat-option>
                    }
                  </mat-select>
                  <mat-hint>
                    Leave empty to match all accounts
                  </mat-hint>
                </mat-form-field>

                <mat-form-field
                  appearance="outline"
                  class="config-field"
                >
                  <mat-label>Keyword Patterns</mat-label>
                  <input
                    matInput
                    [ngModel]="
                      joinPatterns(n.configuration['patterns'])
                    "
                    (ngModelChange)="updatePatterns($event)"
                    placeholder="e.g. hello, help, start"
                  />
                  <mat-hint>
                    Comma-separated; empty matches all
                  </mat-hint>
                </mat-form-field>
              }

              @if (
                n.configuration['direction'] === 'outbound'
              ) {
                <mat-form-field
                  appearance="outline"
                  class="config-field"
                >
                  <mat-label>Channel Account</mat-label>
                  <mat-select
                    [ngModel]="n.configuration['accountId']"
                    (ngModelChange)="
                      onOutboundAccountChange($event)
                    "
                  >
                    @for (
                      acc of channelAccounts();
                      track acc.id
                    ) {
                      <mat-option [value]="acc.id">
                        {{ acc.name }} ({{ acc.channel }})
                      </mat-option>
                    }
                  </mat-select>
                </mat-form-field>

                <mat-form-field
                  appearance="outline"
                  class="config-field"
                >
                  <mat-label>Recipient</mat-label>
                  <mat-select
                    [ngModel]="
                      n.configuration['recipientMode']
                    "
                    (ngModelChange)="
                      onRecipientModeChange($event)
                    "
                  >
                    <mat-option value="sender">
                      Reply to sender
                    </mat-option>
                    <mat-option value="custom">
                      Custom number
                    </mat-option>
                  </mat-select>
                </mat-form-field>

                @if (
                  n.configuration['recipientMode'] ===
                  'custom'
                ) {
                  <mat-form-field
                    appearance="outline"
                    class="config-field"
                  >
                    <mat-label>Phone number</mat-label>
                    <input
                      matInput
                      [ngModel]="n.configuration['to']"
                      (ngModelChange)="
                        updateConfig('to', $event)
                      "
                      placeholder="e.g. +1234567890"
                    />
                    <mat-hint>
                      Supports
                      {{ '{{' }}path{{ '}}' }}
                      expressions
                    </mat-hint>
                  </mat-form-field>
                }

                <mat-form-field
                  appearance="outline"
                  class="config-field"
                >
                  <mat-label>Message Type</mat-label>
                  <mat-select
                    [ngModel]="
                      n.configuration['messageType']
                    "
                    (ngModelChange)="
                      updateConfig('messageType', $event)
                    "
                  >
                    <mat-option value="text">Text</mat-option>
                    <mat-option value="template">
                      Template
                    </mat-option>
                    <mat-option value="image">
                      Image
                    </mat-option>
                    <mat-option value="document">
                      Document
                    </mat-option>
                  </mat-select>
                </mat-form-field>

                @if (
                  n.configuration['messageType'] === 'text'
                ) {
                  <mat-form-field
                    appearance="outline"
                    class="config-field"
                  >
                    <mat-label>Text</mat-label>
                    <textarea
                      matInput
                      rows="3"
                      [ngModel]="n.configuration['text']"
                      (ngModelChange)="
                        updateConfig('text', $event)
                      "
                    ></textarea>
                  </mat-form-field>
                }

                @if (
                  n.configuration['messageType'] ===
                  'template'
                ) {
                  <mat-form-field
                    appearance="outline"
                    class="config-field"
                  >
                    <mat-label>Template Name</mat-label>
                    <input
                      matInput
                      [ngModel]="
                        n.configuration['templateName']
                      "
                      (ngModelChange)="
                        updateConfig('templateName', $event)
                      "
                    />
                  </mat-form-field>
                  <mat-form-field
                    appearance="outline"
                    class="config-field"
                  >
                    <mat-label>Template Language</mat-label>
                    <input
                      matInput
                      [ngModel]="
                        n.configuration['templateLanguage']
                      "
                      (ngModelChange)="
                        updateConfig(
                          'templateLanguage',
                          $event
                        )
                      "
                      placeholder="e.g. en_US"
                    />
                  </mat-form-field>
                }

                @if (
                  n.configuration['messageType'] === 'image' ||
                  n.configuration['messageType'] ===
                    'document'
                ) {
                  <mat-form-field
                    appearance="outline"
                    class="config-field"
                  >
                    <mat-label>Media URL</mat-label>
                    <input
                      matInput
                      [ngModel]="
                        n.configuration['mediaUrl']
                      "
                      (ngModelChange)="
                        updateConfig('mediaUrl', $event)
                      "
                    />
                  </mat-form-field>
                  <mat-form-field
                    appearance="outline"
                    class="config-field"
                  >
                    <mat-label>Caption</mat-label>
                    <input
                      matInput
                      [ngModel]="
                        n.configuration['caption']
                      "
                      (ngModelChange)="
                        updateConfig('caption', $event)
                      "
                    />
                  </mat-form-field>
                }
              }
            }

            @case (types.JS_FUNCTION) {
              <mat-form-field appearance="outline" class="config-field">
                <mat-label>Code</mat-label>
                <textarea
                  matInput
                  rows="6"
                  [ngModel]="n.configuration['code']"
                  (ngModelChange)="updateConfig('code', $event)"
                ></textarea>
              </mat-form-field>
            }

            @case (types.ENDPOINT_CALL) {
              <mat-form-field appearance="outline" class="config-field">
                <mat-label>Adapter</mat-label>
                <mat-select
                  [ngModel]="n.configuration['adapterId']"
                  (ngModelChange)="updateConfig('adapterId', $event)"
                >
                  <mat-option [value]="''">None</mat-option>
                  @for (a of adapters(); track a.id) {
                    <mat-option [value]="a.id">
                      {{ a.name }}
                    </mat-option>
                  }
                </mat-select>
                <mat-hint>Select a connector</mat-hint>
              </mat-form-field>

              @if (n.configuration['adapterId']) {
                <mat-form-field
                  appearance="outline"
                  class="config-field"
                >
                  <mat-label>Endpoint</mat-label>
                  <mat-select
                    [ngModel]="n.configuration['endpointId']"
                    (ngModelChange)="updateConfig('endpointId', $event)"
                  >
                    <mat-option [value]="''">None</mat-option>
                    @for (
                      ep of endpointsForAdapter(
                        n.configuration['adapterId']
                      );
                      track ep.id
                    ) {
                      <mat-option [value]="ep.id">
                        {{ ep.label }} ({{ ep.method }} {{ ep.path }})
                      </mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }

              <mat-form-field appearance="outline" class="config-field">
                <mat-label>Method</mat-label>
                <mat-select
                  [ngModel]="n.configuration['method']"
                  (ngModelChange)="updateConfig('method', $event)"
                >
                  <mat-option value="GET">GET</mat-option>
                  <mat-option value="POST">POST</mat-option>
                  <mat-option value="PUT">PUT</mat-option>
                  <mat-option value="PATCH">PATCH</mat-option>
                  <mat-option value="DELETE">DELETE</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="config-field">
                <mat-label>URL</mat-label>
                <input
                  matInput
                  [ngModel]="n.configuration['url']"
                  (ngModelChange)="updateConfig('url', $event)"
                />
              </mat-form-field>
            }

            @case (types.SERVICE_CALL) {
              <mat-form-field appearance="outline" class="config-field">
                <mat-label>Service</mat-label>
                <mat-select
                  [ngModel]="n.configuration['serviceId']"
                  (ngModelChange)="updateConfig('serviceId', $event)"
                >
                  @for (
                    svc of registryService.services();
                    track svc.id
                  ) {
                    <mat-option [value]="svc.id">
                      {{ svc.name }}
                    </mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="config-field">
                <mat-label>Method</mat-label>
                <mat-select
                  [ngModel]="n.configuration['method']"
                  (ngModelChange)="updateConfig('method', $event)"
                >
                  <mat-option value="GET">GET</mat-option>
                  <mat-option value="POST">POST</mat-option>
                  <mat-option value="PUT">PUT</mat-option>
                  <mat-option value="PATCH">PATCH</mat-option>
                  <mat-option value="DELETE">DELETE</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="config-field">
                <mat-label>Path</mat-label>
                <input
                  matInput
                  [ngModel]="n.configuration['path']"
                  (ngModelChange)="updateConfig('path', $event)"
                  placeholder="/resource/{{ '{{' }}results.StepName.data.id{{ '}}' }}"
                />
              </mat-form-field>
              @if (serviceCallMethodHasBody(n.configuration["method"])) {
                <mat-form-field appearance="outline" class="config-field">
                  <mat-label>JSON object or array; put templates in string values (same
                    {{ '{{' }}results.&lt;stepName&gt;.data…{{ '}}' }} as Path).</mat-label>
                  <textarea
                    matInput
                    class="config-json-textarea"
                    rows="8"
                    [ngModel]="serviceCallBodyDraft()"
                    (ngModelChange)="onServiceCallBodyDraft($event)"
                    (blur)="onServiceCallBodyBlur()"
                  ></textarea>
                  @if (serviceCallBodyError()) {
                    <mat-error>{{ serviceCallBodyError() }}</mat-error>
                  }
                </mat-form-field>
              }
            }

            @case (types.SERVICE_BUS_CALL) {
              <mat-form-field appearance="outline" class="config-field">
                <mat-label>NATS Subject</mat-label>
                <input
                  matInput
                  [ngModel]="n.configuration['subject']"
                  (ngModelChange)="updateConfig('subject', $event)"
                />
              </mat-form-field>
            }

            @case (types.AGENT_CALL) {
              <mat-form-field appearance="outline" class="config-field">
                <mat-label>YoizenClaw agent</mat-label>
                <mat-select
                  [ngModel]="n.configuration['agentId']"
                  (ngModelChange)="updateConfig('agentId', $event)"
                >
                  <mat-option [value]="''">Select an agent</mat-option>
                  @for (ag of yoizenclawAgents(); track ag.id) {
                    <mat-option [value]="ag.id">
                      {{ ag.name }}
                    </mat-option>
                  }
                </mat-select>
                <mat-hint>Published agents only</mat-hint>
              </mat-form-field>

              <mat-form-field appearance="outline" class="config-field">
                <mat-label>Message</mat-label>
                <textarea
                  matInput
                  rows="4"
                  [ngModel]="n.configuration['message']"
                  (ngModelChange)="updateConfig('message', $event)"
                  placeholder="User prompt; use prior step output, e.g. {{ '{{' }}results.StepName.data.reply{{ '}}' }}"
                ></textarea>
              </mat-form-field>

              <mat-form-field appearance="outline" class="config-field">
                <mat-label>Conversation ID (optional)</mat-label>
                <input
                  matInput
                  [ngModel]="n.configuration['conversationId']"
                  (ngModelChange)="updateConfig('conversationId', $event)"
                  placeholder="{{ '{{' }}request.conversationId{{ '}}' }}"
                />
              </mat-form-field>
            }

            @case (types.BRANCH) {
              <p class="config-hint">
                Connect multiple outputs from this node to create
                parallel execution branches.
              </p>
            }
          }
        </div>

        <div class="config-footer">
          <button
            mat-flat-button
            color="warn"
            type="button"
            (click)="remove.emit(n.key)"
          >
            <mat-icon>delete</mat-icon>
            Remove
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      width: 300px;
      background: var(--bg-sidebar, var(--bg2));
      border-left: 1px solid var(--border);
      overflow-y: auto;
      flex-shrink: 0;
    }
    .config-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .config-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    .config-title {
      flex: 1;
      font-weight: 600;
      font-size: 14px;
    }
    .config-body {
      flex: 1;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .config-field {
      width: 100%;
    }
    .config-hint {
      font-size: 12px;
      color: var(--text3);
      margin: 0;
    }
    .config-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--border);
    }
    .config-json-textarea {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }
  `,
})
export class WorkflowNodeConfigComponent implements OnInit {
  private readonly channelAdmin = inject(ChannelAdminService);
  private readonly adapterService = inject(HttpAdapterService);
  private readonly yoizenclawAdmin = inject(YoizenclawAdminService);
  readonly registryService = inject(RegistryService);

  readonly node = input<IWorkflowNode | null>(null);
  readonly close = output<void>();
  readonly remove = output<string>();
  readonly configChange = output<{
    key: string;
    field: string;
    value: unknown;
  }>();
  readonly nameChange = output<{ key: string; name: string }>();

  readonly types = EWorkflowNodeType;
  readonly channelAccounts = signal<IChannelAccount[]>([]);
  readonly adapters = signal<IAdapterDto[]>([]);
  readonly yoizenclawAgents = signal<IYoizenclawAgent[]>([]);

  /** Draft JSON for Service Call body; synced when the selected node key changes. */
  readonly serviceCallBodyDraft = signal("");
  readonly serviceCallBodyError = signal<string | null>(null);
  private lastServiceCallSyncKey: string | null = null;

  constructor() {
    effect(() => {
      const n = this.node();
      if (n?.type !== EWorkflowNodeType.SERVICE_CALL) {
        this.lastServiceCallSyncKey = null;
        return;
      }
      if (this.lastServiceCallSyncKey !== n.key) {
        this.lastServiceCallSyncKey = n.key;
        this.serviceCallBodyDraft.set(
          this.formatServiceCallData(n.configuration["data"]),
        );
        this.serviceCallBodyError.set(null);
      }
    });
  }

  ngOnInit(): void {
    this.channelAdmin.listAccounts().subscribe({
      next: (accounts) => this.channelAccounts.set(accounts),
    });
    this.adapterService.list().subscribe({
      next: (list) => this.adapters.set(list),
    });
    this.registryService.loadServices();
    this.yoizenclawAdmin.listAgents({ status: "published", limit: 100 }).subscribe({
      next: (res) => this.yoizenclawAgents.set(res.agents),
      error: () => this.yoizenclawAgents.set([]),
    });
  }

  endpointsForAdapter(adapterId: unknown): IAdapterEndpointDto[] {
    if (!adapterId) return [];
    const adapter = this.adapters().find(
      (a) => a.id === adapterId,
    );
    return adapter?.endpoints ?? [];
  }

  updateConfig(field: string, value: unknown): void {
    const n = this.node();
    if (!n) return;
    this.configChange.emit({ key: n.key, field, value });
  }

  updateField(field: string, value: unknown): void {
    const n = this.node();
    if (!n) return;
    if (field === "name") {
      this.nameChange.emit({ key: n.key, name: value as string });
    }
  }

  joinPatterns(raw: unknown): string {
    if (!Array.isArray(raw)) return "";
    return (raw as string[]).join(", ");
  }

  updatePatterns(csv: string): void {
    const patterns = csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    this.updateConfig("patterns", patterns);
  }

  /**
   * Switches between "reply to sender" (uses the inbound
   * message's `from` field at runtime) and a custom number.
   */
  onRecipientModeChange(mode: string): void {
    this.updateConfig("recipientMode", mode);
    if (mode === "sender") {
      this.updateConfig("to", "{{request.from}}");
    } else {
      this.updateConfig("to", "");
    }
  }

  /**
   * When user picks an outbound account, auto-populate
   * `channel` and `provider` from the account object.
   */
  onOutboundAccountChange(accountId: string): void {
    this.updateConfig("accountId", accountId);
    const acc = this.channelAccounts().find(
      (a) => a.id === accountId,
    );
    if (acc) {
      this.updateConfig("channel", acc.channel);
      this.updateConfig("provider", acc.provider);
    }
  }

  /**
   * Whether the HTTP method typically carries a JSON body in the builder.
   */
  serviceCallMethodHasBody(method: unknown): boolean {
    return method === "POST" || method === "PUT" || method === "PATCH";
  }

  private formatServiceCallData(data: unknown): string {
    if (data === undefined || data === null) {
      return "";
    }
    if (typeof data !== "object") {
      return String(data);
    }
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return "";
    }
  }

  onServiceCallBodyDraft(value: string): void {
    this.serviceCallBodyDraft.set(value);
  }

  /**
   * Parses and persists `data` on blur; empty input clears the body.
   */
  onServiceCallBodyBlur(): void {
    const n = this.node();
    if (!n || n.type !== EWorkflowNodeType.SERVICE_CALL) {
      return;
    }
    const raw = this.serviceCallBodyDraft().trim();
    if (raw === "") {
      this.serviceCallBodyError.set(null);
      this.updateConfig("data", undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        this.serviceCallBodyError.set(
          "Body must be a JSON object or array.",
        );
        return;
      }
      this.serviceCallBodyError.set(null);
      this.updateConfig("data", parsed);
    } catch {
      this.serviceCallBodyError.set("Invalid JSON.");
    }
  }
}
