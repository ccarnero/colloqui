import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  type OnInit,
  output,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import type {
  IAgent,
  IMcpServer,
  IMcpServerTool,
} from "../../../../../../core/models/agent.model";
import type { IChannelAccount } from "../../../../../../core/models/channel-account.model";
import { AgentAdminService } from "../../../../../../core/services/agent-admin.service";
import { ChannelAdminService } from "../../../../../../core/services/channel-admin.service";
import {
  HttpAdapterService,
  type IAdapterDto,
  type IAdapterEndpointDto,
} from "../../../../../../core/services/http-adapter.service";
import { RegistryService } from "../../../../../../core/services/registry.service";
import {
  type ConditionComparator,
  EWorkflowNodeType,
  type IConditionalBranchConfig,
  type IWorkflowNode,
} from "../../../domain/workflow-node.types";
import {
  SOURCE_ACCOUNT_TEMPLATE,
  SOURCE_CHANNEL_TEMPLATE,
  SOURCE_PROVIDER_TEMPLATE,
} from "../../../domain/workflow-node-defaults";
import type { IVariableGroup } from "../template-autocomplete/template-autocomplete.component";
import { TemplateAutocompleteComponent } from "../template-autocomplete/template-autocomplete.component";

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
    TemplateAutocompleteComponent,
  ],
  template: `
    @if (node(); as n) {
      <div class="config-panel">
        <div class="config-header">
          <span class="config-icon-chip">
            <mat-icon>{{ n.icon }}</mat-icon>
          </span>
          <span class="config-title">{{ n.name }}</span>
          <button
            class="config-close-btn"
            type="button"
            (click)="close.emit()"
            aria-label="Close"
          >
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <!-- Tab row (SPEC T08), ported verbatim from
             builder-v2-reference/node-card.html section 3's inspector
             markup: Config / Output / Runs. Only Config has real content
             in the reference AND in this builder — the EXISTING
             WorkflowNodeConfigComponent form fields below are exactly the
             Config tab's content, unchanged. Output/Runs render as
             visually-present but inert tabs (no click handler, no
             fabricated content), same as the reference's static preview —
             a real per-node "Output"/"Runs" tab needs data this component
             has no source for today (the same per-node execution data gap
             T06/T07 investigated for the card footer), so they stay
             non-interactive rather than showing empty/fake panels. -->
        <div class="config-tabs" role="tablist">
          <span class="config-tab config-tab--active" role="tab" aria-selected="true">Config</span>
          <span class="config-tab config-tab--disabled" role="tab" aria-selected="false" aria-disabled="true">Output</span>
          <span class="config-tab config-tab--disabled" role="tab" aria-selected="false" aria-disabled="true">Runs</span>
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
                  <mat-label>Channel Accounts *</mat-label>
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
                  <mat-label>Channel Account *</mat-label>
                  <mat-select
                    [ngModel]="n.configuration['accountId']"
                    (ngModelChange)="
                      onOutboundAccountChange($event)
                    "
                  >
                    <mat-option [value]="SOURCE_ACCOUNT">
                      Same as incoming message
                    </mat-option>
                    @for (
                      acc of outboundAccounts();
                      track acc.id
                    ) {
                      <mat-option [value]="acc.id">
                        {{ acc.name }} ({{ acc.channel }})
                      </mat-option>
                    }
                  </mat-select>
                  <mat-hint>
                    "Same as incoming message" replies on the account
                    that received the message.
                  </mat-hint>
                  @if (
                    triggerAccountIds().length > 0 &&
                    outboundAccounts().length === 0
                  ) {
                    <mat-hint align="end">
                      No specific accounts on the trigger.
                    </mat-hint>
                  }
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
                  <div class="config-field">
                    <label class="config-label">Phone number</label>
                    <app-template-autocomplete
                      [value]="asString(n.configuration['to'])"
                      (valueChange)="updateConfig('to', $event)"
                      [rows]="1"
                      [workflowNodes]="workflowNodes()"
                      [currentNodeKey]="n.key"
                      placeholder="e.g. +1234567890"
                    ></app-template-autocomplete>
                    <span class="config-hint">
                      Supports
                      {{ '{{' }}path{{ '}}' }}
                      expressions
                    </span>
                  </div>
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
                  <div class="config-field">
                    <label class="config-label">Text</label>
                    <app-template-autocomplete
                      [value]="asString(n.configuration['text'])"
                      (valueChange)="updateConfig('text', $event)"
                      [rows]="3"
                      [workflowNodes]="workflowNodes()"
                      [currentNodeKey]="n.key"
                      placeholder="Type {{ '{{' }} for variables"
                    ></app-template-autocomplete>
                  </div>
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
                  (ngModelChange)="onAdapterChange($event)"
                >
                  <mat-option [value]="''">None (custom URL)</mat-option>
                  @for (a of adapters(); track a.id) {
                    <mat-option [value]="a.id">
                      {{ a.name }}
                    </mat-option>
                  }
                </mat-select>
              </mat-form-field>

              @if (n.configuration['adapterId']) {
                <mat-form-field
                  appearance="outline"
                  class="config-field"
                >
                  <mat-label>Endpoint *</mat-label>
                  <mat-select
                    [ngModel]="n.configuration['endpointId']"
                    (ngModelChange)="onEndpointChange($event)"
                  >
                    <mat-option [value]="''">Select an endpoint</mat-option>
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
              } @else {
                <mat-form-field appearance="outline" class="config-field">
                  <mat-label>Method *</mat-label>
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
                <div class="config-field">
                  <label class="config-label">URL *</label>
                  <app-template-autocomplete
                    [value]="asString(n.configuration['url'])"
                    (valueChange)="updateConfig('url', $event)"
                    [rows]="1"
                    [workflowNodes]="workflowNodes()"
                    [currentNodeKey]="n.key"
                    placeholder="https://api.example.com/resource"
                  ></app-template-autocomplete>
                </div>
              }
            }

            @case (types.MCP_CALL) {
              <mat-form-field appearance="outline" class="config-field">
                <mat-label>MCP Server *</mat-label>
                <mat-select
                  [ngModel]="n.configuration['serverId']"
                  (ngModelChange)="onMcpServerChange($event)"
                >
                  <mat-option [value]="''">Select a server</mat-option>
                  @for (s of mcpServers(); track s.id) {
                    <mat-option [value]="s.id">
                      {{ s.name }}
                    </mat-option>
                  }
                </mat-select>
              </mat-form-field>

              @if (n.configuration['serverId']) {
                <mat-form-field
                  appearance="outline"
                  class="config-field"
                >
                  <mat-label>Tool *</mat-label>
                  <mat-select
                    [ngModel]="n.configuration['toolName']"
                    (ngModelChange)="updateConfig('toolName', $event)"
                    [disabled]="mcpToolsLoading()"
                  >
                    <mat-option [value]="''">Select a tool</mat-option>
                    @for (t of mcpTools(); track t.name) {
                      <mat-option [value]="t.name">
                        {{ t.name }}
                      </mat-option>
                    }
                  </mat-select>
                  @if (mcpToolsLoading()) {
                    <mat-hint>Loading tools…</mat-hint>
                  } @else if (mcpToolsError()) {
                    <mat-hint>{{ mcpToolsError() }}</mat-hint>
                  } @else {
                    <mat-hint>Tools discovered live from the server</mat-hint>
                  }
                </mat-form-field>
              }
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
              <div class="config-field">
                <label class="config-label">Path</label>
                <app-template-autocomplete
                  [value]="asString(n.configuration['path'])"
                  (valueChange)="updateConfig('path', $event)"
                  [rows]="1"
                  [workflowNodes]="workflowNodes()"
                  [currentNodeKey]="n.key"
                  placeholder="/resource/{{ '{{' }}results.StepName.data.id{{ '}}' }}"
                ></app-template-autocomplete>
              </div>
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
                <mat-label>AI agent</mat-label>
                <mat-select
                  [ngModel]="n.configuration['agentId']"
                  (ngModelChange)="updateConfig('agentId', $event)"
                >
                  <mat-option [value]="''">Select an agent</mat-option>
                  @for (ag of aiAgents(); track ag.id) {
                    <mat-option [value]="ag.id">
                      {{ ag.name }}
                    </mat-option>
                  }
                </mat-select>
                <mat-hint>Published agents only</mat-hint>
              </mat-form-field>

              <div class="config-field">
                <label class="config-label">Message</label>
                <app-template-autocomplete
                  [value]="asString(n.configuration['message'])"
                  (valueChange)="updateConfig('message', $event)"
                  [rows]="4"
                  [workflowNodes]="workflowNodes()"
                  [currentNodeKey]="n.key"
                  placeholder="User prompt; type {{ '{{' }} for variables"
                ></app-template-autocomplete>
                <span class="config-hint">Use {{ '{{' }}request.X{{ '}}' }} for input variables, {{ '{{' }}results['Step'].data.reply{{ '}}' }} for previous step output</span>
              </div>

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

            @case (types.CONDITIONAL) {
              <div class="conditional-branches">
                @for (branch of getConditionalBranches(n); track $index) {
                  <div class="conditional-branch">
                    <div class="branch-header">
                      <span class="branch-label">Branch {{ $index + 1 }}</span>
                      <button
                        mat-icon-button
                        type="button"
                        class="branch-remove-btn"
                        (click)="removeConditionalBranch($index)"
                      >
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>
                    <mat-form-field appearance="outline" class="config-field">
                      <mat-label>Label</mat-label>
                      <input
                        matInput
                        [ngModel]="branch.label"
                        (ngModelChange)="updateConditionalBranchLabel($index, $event)"
                        placeholder="e.g. Approved"
                      />
                    </mat-form-field>
                    <mat-form-field appearance="outline" class="config-field">
                      <mat-label>Variable</mat-label>
                      <mat-select
                        [ngModel]="branch.condition.variable"
                        (ngModelChange)="updateConditionalBranchCondition($index, 'variable', $event)"
                      >
                        <mat-option value="">-- Select variable --</mat-option>
                        @for (group of variableGroups(); track group.namespace) {
                          <mat-optgroup [label]="group.namespace">
                            @for (v of group.variables; track v.path) {
                              <mat-option [value]="v.path">{{ v.path }}</mat-option>
                            }
                          </mat-optgroup>
                        }
                      </mat-select>
                      <mat-hint>Choose a variable to evaluate</mat-hint>
                    </mat-form-field>
                    <mat-form-field appearance="outline" class="config-field">
                      <mat-label>Comparator</mat-label>
                      <mat-select
                        [ngModel]="branch.condition.comparator"
                        (ngModelChange)="updateConditionalBranchCondition($index, 'comparator', $event)"
                      >
                        @for (opt of comparatorOptions; track opt.value) {
                          <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field appearance="outline" class="config-field">
                      <mat-label>Value</mat-label>
                      <input
                        matInput
                        [ngModel]="branch.condition.value"
                        (ngModelChange)="updateConditionalBranchCondition($index, 'value', $event)"
                        placeholder="e.g. approved"
                      />
                      <mat-hint>Compare against this value. Use {{ '{{' }}X{{ '}}' }} for dynamic values.</mat-hint>
                    </mat-form-field>
                  </div>
                }

                <button
                  mat-stroked-button
                  type="button"
                  (click)="addConditionalBranch()"
                >
                  <mat-icon>add</mat-icon>
                  Add branch
                </button>

                <div class="default-section">
                  <button
                    mat-stroked-button
                    type="button"
                    (click)="toggleDefaultBranch(n)"
                  >
                    <mat-icon>{{ hasDefaultBranch(n) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
                    Default fallback
                  </button>
                  @if (hasDefaultBranch(n)) {
                    <p class="config-hint" style="margin-top: 6px;">
                      Connect another output from this node for the
                      fallback path when no condition matches.
                    </p>
                  }
                </div>
              </div>
            }
          }
        </div>

        <!-- Footer (SPEC T08): node id (mono, per node-card.html section
             3's {{ bSelId }} span) alongside Remove — Remove itself is
             the EXISTING (click)="remove.emit(n.key)" wiring, unchanged. -->
        <div class="config-footer">
          <span class="config-node-id" data-testid="inspector-node-id">{{ n.key }}</span>
          <button
            class="config-remove-btn"
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
    /*
     * SPEC T05 — container/positioning only (T01 finding 2: this component's
     * field set maps directly onto the floating inspector's Config tab).
     * The old surface was a fixed 300px sidebar with its own background and
     * border; the floating inspector wrapper (workflow-builder.component.ts)
     * now supplies the panel chrome (--rd-panel background, shadow, radius),
     * so this :host only needs to fill that wrapper. Form controls, model
     * bindings and all (change) outputs below are untouched.
     */
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow-y: auto;
    }
    .config-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .config-header {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
    }
    /*
     * Icon chip + tab row + close/remove buttons (SPEC T08), ported from
     * builder-v2-reference/node-card.html section 3's inspector markup
     * (26x26 hover-tinted icon chip, header close button, Config/Output/
     * Runs tab row, red-outlined Remove). These are new elements this
     * task adds to the existing config panel container; the pre-existing
     * form fields below (.config-body downward) keep their current
     * --border/--text2/--text3/--bg tokens untouched, per the "only the
     * container styling changes" scope — these new pieces use the
     * builder-scoped --rd-* tokens (SPEC T02) to match the same chrome
     * language as workflow-builder.component.ts's floating pills.
     */
    .config-icon-chip {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: var(--rd-radius-8);
      background: var(--rd-hover);
      flex-shrink: 0;
    }
    .config-icon-chip mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
      color: var(--rd-text-2);
    }
    .config-close-btn {
      width: 26px;
      height: 26px;
      border: none;
      background: transparent;
      border-radius: var(--rd-radius-5);
      color: var(--rd-text-2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .config-close-btn:hover {
      background: var(--rd-hover);
      color: var(--rd-text-1);
    }
    .config-close-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .config-tabs {
      display: flex;
      border-bottom: 1px solid var(--rd-line);
      padding: 0 var(--rd-space-8);
      gap: var(--rd-space-1);
    }
    .config-tab {
      padding: var(--rd-space-4) var(--rd-space-5);
      font-size: var(--rd-text-size-sm);
      color: var(--rd-text-3);
      margin-bottom: -1px;
    }
    .config-tab--active {
      font-weight: 500;
      color: var(--rd-text-1);
      border-bottom: 2px solid var(--rd-text-1);
    }
    /* Output/Runs tabs (SPEC T08): visually present, per the reference,
       but inert — no click handler, no per-node output/run data source
       exists to back a real tab switch today (same data gap as T06/T07's
       per-node stats). Not a disabled <button> (nothing to disable, no
       action wired) — a plain non-interactive label, cursor:default. */
    .config-tab--disabled {
      cursor: default;
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
    .config-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text2, #666);
      margin-bottom: 4px;
      transform: none;
    }
    .config-footer {
      padding: var(--rd-space-6) var(--rd-space-8);
      border-top: 1px solid var(--rd-line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--rd-space-4);
    }
    .config-node-id {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs);
      color: var(--rd-text-3);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .config-remove-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-2);
      padding: var(--rd-space-3) var(--rd-space-6);
      border-radius: var(--rd-radius-7);
      font-size: var(--rd-text-size-sm);
      font-weight: 500;
      cursor: pointer;
      background: transparent;
      color: var(--rd-red);
      border: 1px solid var(--rd-line-3);
      font-family: inherit;
      flex-shrink: 0;
    }
    .config-remove-btn:hover {
      background: var(--rd-red-dim);
      border-color: var(--rd-red);
    }
    .config-remove-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .config-json-textarea {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }
    .conditional-branches {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .conditional-branch {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg);
    }
    .branch-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .branch-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text2);
    }
    .branch-remove-btn {
      width: 28px !important;
      height: 28px !important;
      line-height: 28px !important;
    }
    .branch-remove-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .default-section {
      margin-top: 4px;
    }
  `,
})
export class WorkflowNodeConfigComponent implements OnInit {
  private readonly channelAdmin = inject(ChannelAdminService);
  private readonly adapterService = inject(HttpAdapterService);
  private readonly agentAdmin = inject(AgentAdminService);
  readonly registryService = inject(RegistryService);

  readonly node = input<IWorkflowNode | null>(null);
  /**
   * Account IDs declared on the inbound trigger. When non-empty,
   * outbound channelSend dropdowns are filtered to those accounts.
   */
  readonly triggerAccountIds = input<string[]>([]);
  /**
   * All workflow nodes (as a flat array) — used by template-autocomplete
   * to offer step results as variable suggestions.
   */
  readonly workflowNodes = input<IWorkflowNode[]>([]);
  /**
   * Variable groups computed by the builder, used for the conditional
   * branch variable dropdown.
   */
  readonly variableGroups = input<IVariableGroup[]>([]);
  readonly close = output<void>();
  readonly remove = output<string>();
  readonly configChange = output<{
    key: string;
    field: string;
    value: unknown;
  }>();
  readonly nameChange = output<{ key: string; name: string }>();

  readonly types = EWorkflowNodeType;
  /** Sentinel value for the "Same as incoming message" account option. */
  readonly SOURCE_ACCOUNT = SOURCE_ACCOUNT_TEMPLATE;
  readonly channelAccounts = signal<IChannelAccount[]>([]);
  readonly adapters = signal<IAdapterDto[]>([]);
  readonly aiAgents = signal<IAgent[]>([]);
  readonly mcpServers = signal<IMcpServer[]>([]);
  /** Tools of the currently-selected MCP server (fetched live per §2.4). */
  readonly mcpTools = signal<IMcpServerTool[]>([]);
  readonly mcpToolsLoading = signal(false);
  readonly mcpToolsError = signal<string | null>(null);
  /** Server id whose tools are currently loaded, to avoid redundant refetches. */
  private lastMcpToolsServerId: string | null = null;

  /**
   * Channel accounts allowed in the outbound `channelSend` dropdown.
   * Filtered by the trigger's accountIds so the user can only pick
   * accounts the workflow is actually listening on. Falls back to
   * the full list when the trigger hasn't picked any (transient
   * state during construction). The currently selected account is
   * always included even if it falls outside the trigger's accounts,
   * since a workflow can legitimately send on an account the trigger
   * doesn't listen on (e.g. notify via a different channel than the
   * one that triggered the workflow) — otherwise the select would
   * render blank despite having a valid configured value.
   */
  readonly outboundAccounts = computed<IChannelAccount[]>(() => {
    const all = this.channelAccounts();
    const allowed = this.triggerAccountIds();
    const allowedSet = new Set(allowed);
    const filtered =
      allowed.length === 0 ? all : all.filter((a) => allowedSet.has(a.id));

    const selectedAccountId = this.node()?.configuration["accountId"];
    if (
      typeof selectedAccountId !== "string" ||
      !selectedAccountId ||
      selectedAccountId === this.SOURCE_ACCOUNT
    ) {
      return filtered;
    }
    if (filtered.some((a) => a.id === selectedAccountId)) {
      return filtered;
    }
    const selectedAccount = all.find((a) => a.id === selectedAccountId);
    return selectedAccount ? [...filtered, selectedAccount] : filtered;
  });

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
          this.formatServiceCallData(n.configuration["data"])
        );
        this.serviceCallBodyError.set(null);
      }
    });

    // Load the selected MCP server's tools when an mcpCall node is opened or
    // its server changes. Tools are discovered live from the server's own
    // tools/list (mcp-connections.md §2.4), so they can only be fetched once a
    // server is picked.
    effect(() => {
      const n = this.node();
      if (n?.type !== EWorkflowNodeType.MCP_CALL) {
        this.lastMcpToolsServerId = null;
        return;
      }
      const serverId = n.configuration["serverId"];
      if (typeof serverId !== "string" || serverId.length === 0) {
        this.lastMcpToolsServerId = null;
        this.mcpTools.set([]);
        return;
      }
      if (this.lastMcpToolsServerId !== serverId) {
        this.loadMcpTools(serverId);
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
    this.agentAdmin.listAgents({ status: "published", limit: 100 }).subscribe({
      next: (res) => this.aiAgents.set(res.agents),
      error: () => this.aiAgents.set([]),
    });
    this.agentAdmin.listMcpServers().subscribe({
      next: (list) => this.mcpServers.set(list),
      error: () => this.mcpServers.set([]),
    });
  }

  /**
   * Switches the selected MCP server: clears the dependent tool selection
   * (a tool from the previous server is meaningless on the new one) and
   * triggers a live tools/list fetch for the new server (mcp-connections.md
   * §5.3 — same two-dropdown dependent UX as adapter/endpoint).
   */
  onMcpServerChange(serverId: unknown): void {
    const next = typeof serverId === "string" ? serverId : "";
    this.updateConfig("serverId", next);
    this.updateConfig("toolName", "");
    if (next) {
      this.loadMcpTools(next);
    } else {
      this.lastMcpToolsServerId = null;
      this.mcpTools.set([]);
      this.mcpToolsError.set(null);
    }
  }

  private loadMcpTools(serverId: string): void {
    this.lastMcpToolsServerId = serverId;
    this.mcpToolsLoading.set(true);
    this.mcpToolsError.set(null);
    this.mcpTools.set([]);
    this.agentAdmin.listMcpServerTools(serverId).subscribe({
      next: (tools) => {
        this.mcpTools.set(tools);
        this.mcpToolsLoading.set(false);
      },
      error: () => {
        this.mcpToolsError.set("Could not load tools from this server.");
        this.mcpToolsLoading.set(false);
      },
    });
  }

  endpointsForAdapter(adapterId: unknown): IAdapterEndpointDto[] {
    if (!adapterId) {
      return [];
    }
    const adapter = this.adapters().find((a) => a.id === adapterId);
    return adapter?.endpoints ?? [];
  }

  /**
   * Switches between adapter mode and URL ad-hoc mode.
   *
   * When an adapter is selected we clear `method`/`url` and reset
   * `endpointId` so the user must pick an endpoint explicitly. When
   * the user goes back to "None" we clear adapter-related fields so
   * the payload doesn't carry stale references.
   */
  onAdapterChange(adapterId: unknown): void {
    const next = typeof adapterId === "string" ? adapterId : "";
    this.updateConfig("adapterId", next);
    this.updateConfig("endpointId", "");
    if (next) {
      // Entering adapter mode: clear URL ad-hoc fields.
      this.updateConfig("method", "");
      this.updateConfig("url", "");
    }
  }

  /**
   * Auto-fills `method`/`url` from the selected endpoint so the
   * serialized payload remains valid for the backend (which still
   * requires both fields as strings).
   */
  onEndpointChange(endpointId: unknown): void {
    const next = typeof endpointId === "string" ? endpointId : "";
    this.updateConfig("endpointId", next);
    if (!next) {
      this.updateConfig("method", "");
      this.updateConfig("url", "");
      return;
    }
    const adapterId = this.node()?.configuration["adapterId"];
    const endpoint = this.endpointsForAdapter(adapterId).find(
      (e) => e.id === next
    );
    if (endpoint) {
      this.updateConfig("method", endpoint.method);
      this.updateConfig("url", endpoint.path);
    }
  }

  updateConfig(field: string, value: unknown): void {
    const n = this.node();
    if (!n) {
      return;
    }
    this.configChange.emit({ key: n.key, field, value });
  }

  updateField(field: string, value: unknown): void {
    const n = this.node();
    if (!n) {
      return;
    }
    if (field === "name") {
      this.nameChange.emit({ key: n.key, name: value as string });
    }
  }

  asString(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  joinPatterns(raw: unknown): string {
    if (!Array.isArray(raw)) {
      return "";
    }
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
   * When user picks an outbound account, auto-populate `channel` and
   * `provider`. For "Same as incoming message" these come from the inbound
   * message at runtime (request templates) so the reply rides the source
   * account; otherwise they're taken from the selected account object.
   */
  onOutboundAccountChange(accountId: string): void {
    this.updateConfig("accountId", accountId);
    if (accountId === this.SOURCE_ACCOUNT) {
      this.updateConfig("channel", SOURCE_CHANNEL_TEMPLATE);
      this.updateConfig("provider", SOURCE_PROVIDER_TEMPLATE);
      return;
    }
    const acc = this.channelAccounts().find((a) => a.id === accountId);
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

  // ── Conditional branch helpers ────────────────────────────────────

  readonly comparatorOptions: Array<{
    value: ConditionComparator;
    label: string;
  }> = [
    { value: "eq", label: "Equals" },
    { value: "neq", label: "Not equals" },
    { value: "gt", label: "Greater than" },
    { value: "lt", label: "Less than" },
    { value: "gte", label: "Greater or equal" },
    { value: "lte", label: "Less or equal" },
    { value: "contains", label: "Contains" },
    { value: "exists", label: "Exists" },
    { value: "notExists", label: "Not exists" },
  ];

  getConditionalBranches(node: IWorkflowNode): IConditionalBranchConfig[] {
    const branches = node.configuration["branches"];
    return Array.isArray(branches)
      ? (branches as IConditionalBranchConfig[])
      : [];
  }

  addConditionalBranch(): void {
    const n = this.node();
    if (!n) {
      return;
    }
    const branches = [...this.getConditionalBranches(n)];
    branches.push({
      label: `Branch ${branches.length + 1}`,
      condition: {
        variable: "",
        comparator: "eq",
        value: "",
      },
    });
    this.updateConfig("branches", branches);
  }

  removeConditionalBranch(index: number): void {
    const n = this.node();
    if (!n) {
      return;
    }
    const branches = [...this.getConditionalBranches(n)];
    branches.splice(index, 1);
    this.updateConfig("branches", branches);
  }

  updateConditionalBranchLabel(index: number, label: string): void {
    const n = this.node();
    if (!n) {
      return;
    }
    const branches = [...this.getConditionalBranches(n)];
    if (!branches[index]) {
      return;
    }
    branches[index] = { ...branches[index], label };
    this.updateConfig("branches", branches);
  }

  updateConditionalBranchCondition(
    index: number,
    field: string,
    value: string
  ): void {
    const n = this.node();
    if (!n) {
      return;
    }
    const branches = [...this.getConditionalBranches(n)];
    if (!branches[index]) {
      return;
    }
    branches[index] = {
      ...branches[index],
      condition: {
        ...branches[index].condition,
        [field]: value,
      },
    };
    this.updateConfig("branches", branches);
  }

  hasDefaultBranch(node: IWorkflowNode): boolean {
    return !!node.configuration["default"];
  }

  toggleDefaultBranch(node: IWorkflowNode): void {
    if (this.hasDefaultBranch(node)) {
      this.updateConfig("default", undefined);
    } else {
      this.updateConfig("default", { targetKey: "" });
    }
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
        this.serviceCallBodyError.set("Body must be a JSON object or array.");
        return;
      }
      this.serviceCallBodyError.set(null);
      this.updateConfig("data", parsed);
    } catch {
      this.serviceCallBodyError.set("Invalid JSON.");
    }
  }
}
