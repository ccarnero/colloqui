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
import { filterVariableGroups } from "../../../domain/filter-variable-groups";
import { findAmbiguousBranchEvidenceKeys } from "../../../domain/find-ambiguous-branch-evidence-keys";
import { conditionEdgeLabel } from "../../../domain/flow-deserializer";
import { getConditionalBranches as getConditionalBranchesShared } from "../../../domain/get-conditional-branches";
import type { INodeStatsBranchRow } from "../../../domain/map-node-stats-to-view-models";
import {
  type IBranchEvidence,
  resolveBranchEvidence,
} from "../../../domain/resolve-branch-evidence";
import {
  type IBranchRouteTarget,
  resolveConditionalBranchTarget,
} from "../../../domain/resolve-conditional-branch-target";
import { splitVariablePath } from "../../../domain/split-variable-path";
import {
  type ConditionComparator,
  EWorkflowNodeType,
  type IConditionalBranchConfig,
  type IWorkflowConnection,
  type IWorkflowNode,
} from "../../../domain/workflow-node.types";
import {
  SOURCE_ACCOUNT_TEMPLATE,
  SOURCE_CHANNEL_TEMPLATE,
  SOURCE_PROVIDER_TEMPLATE,
} from "../../../domain/workflow-node-defaults";
import type { IVariableGroup } from "../template-autocomplete/template-autocomplete.component";
import { TemplateAutocompleteComponent } from "../template-autocomplete/template-autocomplete.component";
import { nodeTypeColorToken } from "../workflow-node/node-type-color";
import { nodeTypeShortLabel } from "../workflow-node/node-type-short-label";
import { nodeTypeTintToken } from "../workflow-node/node-type-tint";
import type { IWorkflowNodeStats } from "../workflow-node/workflow-node-stats.types";

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
          <!-- Type badge (IF-editor round-2 task), ported verbatim from
               if-editor-proposal.html's ".type-badge" — reuses the SAME
               short label (node-type-short-label.ts) the node card's own
               type badge already shows, so header and card always agree. -->
          <span class="config-type-badge">{{ nodeTypeShortLabel(n.type) }}</span>
          <button
            class="config-close-btn"
            type="button"
            (click)="close.emit()"
            aria-label="Close"
          >
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <!-- Activity strip (shape-scoped inspector correction, replaces the
             removed Config/Output/Runs tab bar per
             manual-loops/admin-console/design/proposals/if-editor-shape-scoped.html):
             a single, read-only line sourced from the SAME nodeStatsByName
             input the node card's own footer already reads — zero new
             requests. Hidden entirely when there is no stats row for this
             node (never renders fabricated zeros), matching the card
             footer's own "hidden" state contract
             (workflow-node-stats.types.ts). The "View in Runs" link is the
             ONLY place workflow-level run/output UI is reachable from a
             shape panel now — it deep-links out to the top-level Runs tab
             instead of rendering runs/output inline. -->
        @if (selectedNodeStats(); as stats) {
          <div class="activity-strip" data-testid="activity-strip">
            <span>{{ stats.primaryLabel }}</span>
            @if (stats.secondaryLabel) {
              <span>·</span>
              <span>{{ stats.secondaryLabel }}</span>
            }
            @if (stats.status; as status) {
              <span>·</span>
              <span class="activity-dot" [class]="'dot-' + status"></span>
              <span>{{ status }}</span>
            }
            <button
              type="button"
              class="activity-go-runs"
              data-testid="activity-view-in-runs"
              (click)="onViewInRuns()"
            >
              View in Runs
              <mat-icon>north_east</mat-icon>
            </button>
          </div>
        }

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
              <!--
                Sentence-form conditional branches (SPEC
                console-redesign-builder-v2 IF-editor task, proposal ideas
                1-6): each branch renders as a card reading "If <variable>
                <comparator> <value>", with the same expression chip styling
                the canvas edge label uses, a route-target row derived from
                flow state, and per-branch run evidence joined from
                unmerged /node-stats rows. The persisted branch model
                {label, condition:{variable, comparator, value}} and its
                serializer/deserializer/validation are UNCHANGED — only this
                block's presentation differs from the pre-existing four
                stacked mat-form-fields.

                Attempt 2 (dual-review fixes): the default-branch card is
                now DISPLAY ONLY (objection 3) — it renders when
                hasDefaultBranch(n) is true and renders nothing otherwise;
                there is no "Add default branch" affordance here, since the
                canvas-level mechanism (connecting another output) is the
                one real way to create a default path, and the previous
                button's add path never serialized (dead end).
              -->
              <div class="conditional-branches">
                <div class="cb-section-label">
                  Branches · evaluated top to bottom, first match wins
                </div>

                @for (branch of getConditionalBranches(n); track $index) {
                  <!-- Active-branch accent border (IF-editor round-2 task),
                       ported verbatim from if-editor-proposal.html's
                       ".branch-card.active-branch" — every conditional
                       (non-default) branch card gets it, matching the
                       mock's single-condition example; the "Otherwise"
                       default-branch card below deliberately does NOT. -->
                  <div class="branch-card bc-active">
                    <div class="bc-head">
                      <span class="bc-dot"></span>
                      <input
                        class="bc-label-input"
                        [ngModel]="branch.label"
                        (ngModelChange)="updateConditionalBranchLabel($index, $event)"
                        placeholder="Branch label"
                        aria-label="Branch label"
                      />
                      <mat-icon class="bc-edit-ic">edit</mat-icon>
                      <button
                        mat-icon-button
                        type="button"
                        class="bc-x"
                        (click)="removeConditionalBranch($index)"
                        aria-label="Remove branch"
                      >
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>

                    <div class="bc-sentence">
                      <span class="bc-sw">If</span>

                      <button
                        type="button"
                        class="bc-var-pill"
                        [class.bc-var-pill--open]="openBranchPickerIndex() === $index"
                        (click)="toggleVariablePicker($index)"
                      >
                        @if (branch.condition.variable) {
                          <span class="path-root">{{ splitPath(branch.condition.variable).root }}</span>{{ splitPath(branch.condition.variable).leaf }}
                        } @else {
                          <span class="bc-var-placeholder">Select variable</span>
                        }
                        <mat-icon>unfold_more</mat-icon>
                      </button>

                      <!-- Comparator pill (IF-editor round-2 task): a
                           native <select appearance:none> styled as the
                           SAME ".pill" if-editor-proposal.html uses for
                           the variable/value pills, per the round-2 brief
                           ("the comparator can be a styled select with
                           appearance:none") — replaces the tall bordered
                           mat-form-field/mat-select that read nothing like
                           the mock's slim inline pill. Native <select>
                           keeps full keyboard/focus accessibility for
                           free. -->
                      <span class="pill bc-comparator-pill">
                        <select
                          class="bc-comparator-select"
                          [ngModel]="branch.condition.comparator"
                          (ngModelChange)="updateConditionalBranchCondition($index, 'comparator', $event)"
                          aria-label="Comparator"
                        >
                          @for (opt of comparatorOptions; track opt.value) {
                            <option [value]="opt.value">{{ opt.label }}</option>
                          }
                        </select>
                        <mat-icon>arrow_drop_down</mat-icon>
                      </span>

                      <span class="pill mono-pill bc-value-pill">
                        <span class="bc-quote">"</span>
                        <input
                          class="bc-value-input"
                          [ngModel]="branch.condition.value"
                          (ngModelChange)="updateConditionalBranchCondition($index, 'value', $event)"
                          placeholder="value"
                          aria-label="Comparison value"
                        />
                        <span class="bc-quote">"</span>
                      </span>
                    </div>

                    @if (openBranchPickerIndex() === $index) {
                      <div class="picker" data-testid="branch-variable-picker">
                        <div class="picker-search">
                          <mat-icon>search</mat-icon>
                          <input
                            [ngModel]="branchPickerQuery()"
                            (ngModelChange)="branchPickerQuery.set($event)"
                            placeholder="Search variables…"
                            autocomplete="off"
                            aria-label="Search variables"
                          />
                        </div>
                        @for (group of filteredVariableGroups(); track group.namespace) {
                          <div class="picker-group">{{ group.icon }} {{ group.namespace }}</div>
                          @for (v of group.variables; track v.path) {
                            <button
                              type="button"
                              class="picker-item"
                              [class.sel]="v.path === branch.condition.variable"
                              (click)="selectBranchVariable($index, v.path)"
                            >
                              <span class="picker-item-path">
                                <span class="path-root">{{ splitPath(v.path).root }}</span>{{ splitPath(v.path).leaf }}
                              </span>
                            </button>
                          }
                        }
                        @if (filteredVariableGroups().length === 0) {
                          <div class="picker-empty">No variables match.</div>
                        }
                      </div>
                    }

                    @if (exprChipFor(branch); as exprText) {
                      <div class="expr-row">
                        <span class="expr-chip">
                          <mat-icon>commit</mat-icon>
                          {{ exprText }}
                        </span>
                      </div>
                    }

                    <div class="bc-foot">
                      @if (routeTargetForBranch(n, exprChipFor(branch)); as rt) {
                        <div class="route">
                          <mat-icon>south</mat-icon>
                          <span
                            class="mini-chip"
                            [style.background]="nodeTypeTint(rt.node.type)"
                            [style.color]="nodeTypeColor(rt.node.type)"
                          >
                            <mat-icon>{{ rt.node.icon }}</mat-icon>
                          </span>
                          <span class="target">{{ rt.node.name }}</span>
                        </div>
                      } @else {
                        <span></span>
                      }
                      @if (nodeStatsFetchState() === 'loading') {
                        <span class="evidence evidence-skeleton" aria-hidden="true">···</span>
                      } @else if (branchEvidenceFor(n, branch.label, routeTargetForBranch(n, exprChipFor(branch))?.node?.name); as ev) {
                        <span class="evidence">matched <b>{{ ev.matched }}</b>/{{ ev.total }} · {{ ev.percent }}%</span>
                      }
                    </div>
                  </div>
                }

                @if (hasDefaultBranch(n)) {
                  <div class="branch-card" data-testid="default-branch-card">
                    <div class="bc-head">
                      <span class="bc-dot bc-dot--grey"></span>
                      <span class="bc-label-default">
                        Otherwise <span class="bc-label-default-sub">· default</span>
                      </span>
                      <button
                        mat-icon-button
                        type="button"
                        class="bc-x"
                        (click)="toggleDefaultBranch(n)"
                        aria-label="Remove default branch"
                      >
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>
                    <div class="bc-foot">
                      @if (defaultRouteTargetFor(n); as rt) {
                        <div class="route">
                          <mat-icon>south</mat-icon>
                          <span
                            class="mini-chip"
                            [style.background]="nodeTypeTint(rt.node.type)"
                            [style.color]="nodeTypeColor(rt.node.type)"
                          >
                            <mat-icon>{{ rt.node.icon }}</mat-icon>
                          </span>
                          <span class="target">{{ rt.node.name }}</span>
                        </div>
                      } @else {
                        <span></span>
                      }
                      @if (nodeStatsFetchState() === 'loading') {
                        <span class="evidence evidence-skeleton" aria-hidden="true">···</span>
                      } @else if (branchEvidenceFor(n, 'default', defaultRouteTargetFor(n)?.node?.name); as ev) {
                        <span class="evidence">matched <b>{{ ev.matched }}</b>/{{ ev.total }} · {{ ev.percent }}%</span>
                      }
                    </div>
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
    /* Type badge (IF-editor round-2 task), ported verbatim from
     * if-editor-proposal.html's ".type-badge" (mono, yellow, 1px yellow
     * border, 4px radius, 9px/0.6px letter-spacing). */
    .config-type-badge {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-3xs);
      letter-spacing: 0.6px;
      color: var(--rd-yellow);
      border: 1px solid var(--rd-yellow);
      border-radius: var(--rd-radius-4);
      padding: 1px 6px;
      flex-shrink: 0;
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
    /*
     * Activity strip (shape-scoped inspector correction), ported from
     * if-editor-shape-scoped.html's ".activity-strip"/".go-runs" onto the
     * builder-scoped --rd-* tokens (SPEC T02) — replaces the removed
     * Config/Output/Runs tab bar. Single read-only line; the "View in
     * Runs" button is the only interactive element, deep-linking to the
     * top-level Runs tab instead of rendering workflow-level UI here.
     */
    .activity-strip {
      display: flex;
      align-items: center;
      gap: var(--rd-space-3);
      padding: var(--rd-space-4) var(--rd-space-8);
      border-bottom: 1px solid var(--rd-line-2);
      background: var(--rd-line-2);
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-3xs);
      color: var(--rd-text-2);
    }
    .activity-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--rd-text-3);
    }
    .activity-dot.dot-ok {
      background: var(--rd-green);
    }
    .activity-dot.dot-warning {
      background: var(--rd-yellow);
    }
    .activity-dot.dot-error {
      background: var(--rd-red);
    }
    .activity-go-runs {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-2);
      font-family: var(--rd-font-sans, inherit);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-link, var(--rd-accent));
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
    }
    .activity-go-runs:hover {
      text-decoration: underline;
    }
    .activity-go-runs mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
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

    /*
     * Sentence-form conditional branch cards (SPEC console-redesign-builder-v2
     * IF-editor task), ported from the if-editor-proposal.html mock's
     * branch-card / bc-* / sentence / pill / expr-chip / route / evidence /
     * picker / picker-* rules, mapped onto the existing builder-scoped
     * --rd-* tokens (SPEC T02) — values copied, never invented.
     */
    .conditional-branches {
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-6);
    }
    .cb-section-label {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-3xs);
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: var(--rd-text-3);
      margin-top: var(--rd-space-1);
    }
    .branch-card {
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-9);
      background: var(--rd-line-2);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    /* Active-branch accent border (IF-editor round-2 task), ported from
     * if-editor-proposal.html's ".branch-card.active-branch" —
     * color-mix keeps this token-derived (var(--rd-yellow) at the mock's
     * 35% alpha) instead of a hard-coded rgba literal. */
    .branch-card.bc-active {
      border-color: color-mix(in srgb, var(--rd-yellow) 35%, transparent);
    }
    .bc-head {
      display: flex;
      align-items: center;
      gap: var(--rd-space-4);
      padding: var(--rd-space-5) var(--rd-space-6) var(--rd-space-3);
    }
    .bc-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--rd-yellow);
      flex-shrink: 0;
    }
    .bc-dot--grey {
      background: var(--rd-text-3);
    }
    .bc-label-input {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      font-size: var(--rd-text-size-sm);
      color: var(--rd-text-1);
      background: transparent;
      border: none;
      outline: none;
      font-family: inherit;
      padding: 0;
    }
    .bc-label-input::placeholder {
      color: var(--rd-text-3);
      font-weight: 400;
    }
    .bc-edit-ic {
      font-size: 11px !important;
      width: 11px !important;
      height: 11px !important;
      color: var(--rd-text-3);
      flex-shrink: 0;
    }
    .bc-x {
      width: 22px !important;
      height: 22px !important;
      line-height: 22px !important;
      color: var(--rd-text-3);
      flex-shrink: 0;
    }
    .bc-x mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .bc-label-default {
      flex: 1;
      font-weight: 500;
      font-size: var(--rd-text-size-sm);
      color: var(--rd-text-2);
    }
    .bc-label-default-sub {
      font-weight: 400;
      color: var(--rd-text-3);
    }

    .bc-sentence {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--rd-space-3);
      padding: 0 var(--rd-space-6) var(--rd-space-5);
    }
    .bc-sw {
      font-size: var(--rd-text-size-sm);
      color: var(--rd-text-3);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-3);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-5);
      background: var(--rd-panel);
      padding: var(--rd-space-2) var(--rd-space-4);
      font-size: var(--rd-text-size-sm);
      color: var(--rd-text-1);
      max-width: 100%;
    }
    .mono-pill {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs);
    }
    .bc-var-pill {
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-3);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-5);
      background: var(--rd-panel);
      padding: var(--rd-space-2) var(--rd-space-4);
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-1);
      cursor: pointer;
      max-width: 100%;
      overflow: hidden;
    }
    .bc-var-pill--open {
      border-color: var(--rd-accent);
    }
    .bc-var-pill mat-icon {
      font-size: 13px;
      width: 13px;
      height: 13px;
      color: var(--rd-text-3);
      flex-shrink: 0;
    }
    .path-root {
      color: var(--rd-text-3);
    }
    .bc-var-placeholder {
      color: var(--rd-text-2);
    }
    /* Comparator pill (IF-editor round-2 task): a native <select> styled
     * to look like the SAME ".pill" the variable/value pills use, per
     * if-editor-proposal.html's ".sentence .pill" rule — replaces the
     * tall bordered mat-form-field/mat-select. appearance:none strips the
     * browser chrome; the trailing mat-icon supplies the mock's
     * arrow_drop_down affordance. */
    .bc-comparator-pill {
      cursor: pointer;
    }
    .bc-comparator-select {
      appearance: none;
      background: transparent;
      border: none;
      outline: none;
      color: var(--rd-text-1);
      font-family: inherit;
      font-size: inherit;
      padding: 0;
      cursor: pointer;
    }
    .bc-comparator-select option {
      background: var(--rd-panel);
      color: var(--rd-text-1);
    }
    .bc-comparator-pill mat-icon {
      font-size: 13px;
      width: 13px;
      height: 13px;
      color: var(--rd-text-3);
      flex-shrink: 0;
    }
    .bc-value-pill {
      gap: 0;
    }
    .bc-quote {
      color: var(--rd-text-3);
    }
    /* Sizes to its OWN RENDERED CONTENT (IF-editor round-2 task, dual-review
     * fix — the earlier [attr.size] attempt was rejected: HTML size is an
     * average-character-width heuristic and never collapses to the exact
     * rendered pixel width, so "vip" still left a visible gap before the
     * closing quote). field-sizing: content makes the UA lay the input
     * out exactly like a span containing the same text — the same "hug the
     * text" behavior the read-only expr-chip two rows below gets for free
     * from being a plain inline element. min-width covers the empty/
     * placeholder state; max-width guards against a very long value
     * pushing the sentence row out of the panel. No manual width
     * measurement (mirror span) is needed — every browser in this app's
     * target matrix (evergreen Chromium-based, per the existing browserslist
     * baseline) ships field-sizing. */
    .bc-value-input {
      background: transparent;
      border: none;
      outline: none;
      color: var(--rd-text-1);
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs);
      field-sizing: content;
      min-width: 8px;
      max-width: 140px;
      padding: 0;
    }

    .picker {
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-7);
      background: var(--rd-panel);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
      overflow: hidden;
      margin: 0 var(--rd-space-6) var(--rd-space-5);
      max-height: 240px;
      overflow-y: auto;
    }
    .picker-search {
      display: flex;
      gap: var(--rd-space-3);
      align-items: center;
      padding: var(--rd-space-4) var(--rd-space-5);
      border-bottom: 1px solid var(--rd-line);
      color: var(--rd-text-3);
      position: sticky;
      top: 0;
      background: var(--rd-panel);
    }
    .picker-search mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .picker-search input {
      background: none;
      border: none;
      outline: none;
      color: var(--rd-text-1);
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs);
      width: 100%;
    }
    .picker-group {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-3xs);
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--rd-text-3);
      padding: var(--rd-space-4) var(--rd-space-5) var(--rd-space-2);
    }
    .picker-item {
      display: flex;
      width: 100%;
      justify-content: space-between;
      align-items: center;
      gap: var(--rd-space-5);
      padding: var(--rd-space-3) var(--rd-space-5);
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-1);
      background: transparent;
      border: none;
      cursor: pointer;
      text-align: left;
    }
    .picker-item:hover {
      background: var(--rd-hover);
    }
    .picker-item.sel {
      background: var(--rd-accent-soft);
    }
    .picker-item-path {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .picker-empty {
      padding: var(--rd-space-5);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-3);
    }

    .expr-row {
      padding: 0 var(--rd-space-6) var(--rd-space-5);
    }
    .expr-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-3);
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs);
      color: var(--rd-text-2);
      background: var(--rd-bg);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-4);
      padding: var(--rd-space-2) var(--rd-space-4);
    }
    .expr-chip mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
      color: var(--rd-text-3);
    }

    .bc-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--rd-space-4);
      border-top: 1px solid var(--rd-line);
      padding: var(--rd-space-3) var(--rd-space-6);
      background: var(--rd-panel);
    }
    .route {
      display: flex;
      align-items: center;
      gap: var(--rd-space-3);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-2);
      min-width: 0;
    }
    .route mat-icon {
      font-size: 13px;
      width: 13px;
      height: 13px;
      color: var(--rd-text-3);
      flex-shrink: 0;
    }
    .route .target {
      color: var(--rd-text-1);
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mini-chip {
      width: 16px;
      height: 16px;
      border-radius: var(--rd-radius-3);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .mini-chip mat-icon {
      font-size: 10px;
      width: 10px;
      height: 10px;
      color: inherit;
    }
    .evidence {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-3xs);
      color: var(--rd-text-3);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .evidence b {
      color: var(--rd-green);
      font-weight: 500;
    }
    .evidence-skeleton {
      opacity: 0.5;
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
   * to offer step results as variable suggestions, AND by the branch
   * evidence ambiguity resolver (attempt 2), which needs visibility into
   * every conditional node in the flow, not just the selected one.
   */
  readonly workflowNodes = input<IWorkflowNode[]>([]);
  /**
   * Variable groups computed by the builder, used for the conditional
   * branch variable dropdown.
   */
  readonly variableGroups = input<IVariableGroup[]>([]);
  /**
   * Current flow connections (SPEC console-redesign-builder-v2 IF-editor
   * task, idea 3): used to resolve each conditional branch's route target
   * node by matching the connection whose label equals the branch's own
   * expression text — see resolve-conditional-branch-target.ts.
   */
  readonly connections = input<IWorkflowConnection[]>([]);
  /**
   * UNMERGED per-(action_name, branch) /node-stats rows (SPEC idea 4), from
   * map-node-stats-to-view-models.ts mapNodeStatsToBranchRows(). Never
   * touches the merged node-card footer behavior.
   */
  readonly nodeStatsBranchRows = input<readonly INodeStatsBranchRow[]>([]);
  /**
   * Each action's own unbranched /node-stats run total, keyed by
   * action_name (map-node-stats-to-view-models.ts
   * mapNodeStatsOwnRunsByName()). Used as the per-branch evidence
   * DENOMINATOR — the conditional node's OWN row, not a sum of sibling
   * branch rows keyed by their current labels (rename-staleness fix,
   * attempt 2 dual-review objection 1).
   */
  readonly nodeStatsOwnRunsByName = input<Readonly<Record<string, number>>>({});
  /** Same fetch-state machine as the builder's node-card footer (T07). */
  readonly nodeStatsFetchState = input<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  /**
   * Per-node footer stats (shape-scoped inspector correction, activity
   * strip) — the SAME merged signal the builder already computes for the
   * node-card footer (T07, `mapNodeStatsToViewModels()` keyed by
   * `action_name`). Reused verbatim: zero new requests for the strip.
   */
  readonly nodeStatsByName = input<
    Readonly<Record<string, IWorkflowNodeStats>>
  >({});
  readonly close = output<void>();
  readonly remove = output<string>();
  readonly configChange = output<{
    key: string;
    field: string;
    value: unknown;
  }>();
  readonly nameChange = output<{ key: string; name: string }>();
  /**
   * Shape-scoped inspector correction: the activity strip's "View in
   * Runs" link never renders workflow-level UI inline — it emits this
   * node's action name so the builder (which already owns `goToTab` and
   * the workflow id) can deep-link out to the top-level Runs tab with
   * `?node=<actionName>`.
   */
  readonly viewInRuns = output<string>();

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
   * Channel accounts allowed in the outbound channelSend dropdown.
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

  /**
   * Which conditional branch's variable picker is open (index into
   * getConditionalBranches(n)), or null when closed (SPEC idea 6). Only
   * one picker is ever open at a time, mirroring a standard dropdown.
   */
  readonly openBranchPickerIndex = signal<number | null>(null);
  /** Search text for the currently-open variable picker. */
  readonly branchPickerQuery = signal<string>("");

  /** Bound pure formatters, kept unit-testable in isolation (same pattern
   * as workflow-builder.component.ts's resolveEdgeLabel/
   * resolveEdgeVisualState bindings). */
  protected readonly splitPath = splitVariablePath;
  protected readonly nodeTypeTint = nodeTypeTintToken;
  protected readonly nodeTypeColor = nodeTypeColorToken;

  readonly nodesByKey = computed<Record<string, IWorkflowNode>>(() => {
    const map: Record<string, IWorkflowNode> = {};
    for (const n of this.workflowNodes()) {
      map[n.key] = n;
    }
    return map;
  });

  /**
   * (targetActionName, branchLabel) keys that MORE THAN ONE conditional
   * node in the current flow routes to (attempt 2, dual-review objection
   * 2): /node-stats groups strictly by (action_name, branch) with no
   * conditional-node discriminator, so two different IF nodes that both
   * route a same-labeled branch (e.g. both have a "default" falling
   * through to replyStandard) would otherwise present ONE merged number as
   * each node's own evidence. Any branch whose key is in this set hides
   * its evidence entirely rather than showing an ambiguous, possibly
   * wrongly-attributed number.
   */
  readonly ambiguousEvidenceKeys = computed<ReadonlySet<string>>(() =>
    findAmbiguousBranchEvidenceKeys(this.workflowNodes(), this.connections())
  );

  /** The already-fetched per-node footer stats for the selected node
   * (activity strip — zero new requests; the SAME numbers the canvas
   * card footer already renders, shape-scoped inspector correction). */
  readonly selectedNodeStats = computed<IWorkflowNodeStats | null>(() => {
    const n = this.node();
    if (!n) {
      return null;
    }
    return this.nodeStatsByName()[n.name] ?? null;
  });

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

    // Closes any open branch picker when the selected node changes, so a
    // stale open picker from a previous node's branch index never lingers.
    effect(() => {
      this.node();
      this.openBranchPickerIndex.set(null);
      this.branchPickerQuery.set("");
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
   * When an adapter is selected we clear method/url and reset
   * endpointId so the user must pick an endpoint explicitly. When
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
   * Auto-fills method/url from the selected endpoint so the
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

  /** Bound to the label(); exposed on the instance so the template can
   * call it (IF-editor round-2 task, header type badge). */
  protected readonly nodeTypeShortLabel = nodeTypeShortLabel;

  /**
   * "View in Runs" (shape-scoped inspector correction): emits the
   * selected node's action name so the builder can navigate to the
   * top-level Runs tab with `?node=<actionName>` — no run/output
   * fetching happens here, this component only ever reads the
   * already-fetched `nodeStatsByName` input.
   */
  onViewInRuns(): void {
    const n = this.node();
    if (!n) {
      return;
    }
    this.viewInRuns.emit(n.name);
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
   * message's from field at runtime) and a custom number.
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
   * When user picks an outbound account, auto-populate channel and
   * provider. For "Same as incoming message" these come from the inbound
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

  /** Delegates to the shared pure reader (domain/get-conditional-branches.ts)
   * so the template, the config panel, and the ambiguity resolver all read
   * a node's branches array the exact same way. */
  getConditionalBranches(node: IWorkflowNode): IConditionalBranchConfig[] {
    return getConditionalBranchesShared(node);
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

  /**
   * Removes an existing default branch (still called from the default
   * branch card's close button). Attempt 2 (dual-review objection 3):
   * this method no longer has a UI-reachable "add" path — the config
   * panel's default card is display-only (renders when hasDefaultBranch(n)
   * is true, nothing otherwise); creating a default branch happens on the
   * canvas by connecting another output from this node, the same
   * mechanism that already existed before this task.
   */
  toggleDefaultBranch(node: IWorkflowNode): void {
    if (this.hasDefaultBranch(node)) {
      console.debug(
        "[WorkflowNodeConfigComponent] default branch removed (IF-editor task)",
        { nodeKey: node.key }
      );
      this.updateConfig("default", undefined);
    }
  }

  /**
   * Opens/closes the variable picker for a given branch index (SPEC idea 6).
   * Clicking the pill for an already-open branch closes it; clicking a
   * different branch's pill switches the open picker to that branch and
   * resets the search text.
   */
  toggleVariablePicker(index: number): void {
    if (this.openBranchPickerIndex() === index) {
      this.closeVariablePicker();
      return;
    }
    console.debug(
      "[WorkflowNodeConfigComponent] variable picker opened (IF-editor task)",
      { branchIndex: index }
    );
    this.openBranchPickerIndex.set(index);
    this.branchPickerQuery.set("");
  }

  closeVariablePicker(): void {
    this.openBranchPickerIndex.set(null);
    this.branchPickerQuery.set("");
  }

  /**
   * Commits a picked variable path onto the branch's condition (frozen
   * IConditionRule.variable field, unchanged shape) and closes the
   * picker. Verbose log records both the picked path and the branch
   * index, to make future placeholder-bug regressions traceable.
   */
  selectBranchVariable(index: number, path: string): void {
    console.debug(
      "[WorkflowNodeConfigComponent] branch variable selected (IF-editor task, placeholder-bug fix)",
      { branchIndex: index, path }
    );
    this.updateConditionalBranchCondition(index, "variable", path);
    this.closeVariablePicker();
  }

  filteredVariableGroups(): IVariableGroup[] {
    return [
      ...filterVariableGroups(this.variableGroups(), this.branchPickerQuery()),
    ];
  }

  /**
   * The branch condition's expression chip text (SPEC idea 2), reusing
   * flow-deserializer.ts's conditionEdgeLabel() — the SAME formatting rule
   * the canvas edge label is built from — so editor and canvas always
   * agree. Returns undefined (no chip) when the condition is genuinely
   * empty: conditionEdgeLabel itself only guards against a non-string/
   * undefined variable, not an empty string, so the emptiness check
   * happens here first.
   */
  exprChipFor(branch: IConditionalBranchConfig): string | undefined {
    if (!branch.condition.variable || !branch.condition.comparator) {
      return undefined;
    }
    return conditionEdgeLabel(
      branch.condition as unknown as Record<string, unknown>
    );
  }

  /**
   * Resolves a conditional branch's route target node (SPEC idea 3) by
   * matching the flow connection whose label equals this branch's own
   * expression text.
   */
  routeTargetForBranch(
    node: IWorkflowNode,
    expectedLabel: string | undefined
  ): IBranchRouteTarget | null {
    return resolveConditionalBranchTarget(
      node.key,
      expectedLabel,
      this.connections(),
      this.nodesByKey()
    );
  }

  /** Same resolution for the default branch's literal "default" label. */
  defaultRouteTargetFor(node: IWorkflowNode): IBranchRouteTarget | null {
    return resolveConditionalBranchTarget(
      node.key,
      "default",
      this.connections(),
      this.nodesByKey()
    );
  }

  /**
   * Per-branch run evidence (SPEC idea 4, revised attempt 2). The
   * numerator joins the unmerged /node-stats branch rows by
   * (action_name, branch) for this branch's own route target + label. The
   * DENOMINATOR is the conditional node's OWN /node-stats row
   * (nodeStatsOwnRunsByName()[node.name]) — rename-proof, since it is
   * keyed only by the node's action_name, not by any branch's current
   * label (attempt 2 dual-review objection 1: summing sibling branch rows
   * keyed by CURRENT labels let a rename silently reassign a branch's
   * historical runs out of its siblings' totals, inflating their
   * percentages).
   *
   * Before joining, checks ambiguousEvidenceKeys() (objection 2): when
   * more than one conditional node in the flow routes a same-labeled
   * branch to the same target action, /node-stats' (action_name, branch)
   * grouping cannot tell them apart, so evidence is suppressed for EVERY
   * node sharing that key rather than presenting a possibly
   * cross-attributed number as fact.
   *
   * Returns null (hidden) while the fetch hasn't resolved, when this
   * branch has no route target yet, when the key is ambiguous, or when
   * there is no real data for either the numerator or the node's own
   * total — never a fabricated/zero/adjusted count.
   */
  branchEvidenceFor(
    node: IWorkflowNode,
    branchLabel: string,
    targetActionName: string | undefined
  ): IBranchEvidence | null {
    if (!targetActionName || this.nodeStatsFetchState() !== "ready") {
      return null;
    }
    const key = `${targetActionName}::${branchLabel}`;
    if (this.ambiguousEvidenceKeys().has(key)) {
      return null;
    }
    const nodeTotalRuns = this.nodeStatsOwnRunsByName()[node.name] ?? null;
    return resolveBranchEvidence(this.nodeStatsBranchRows(), nodeTotalRuns, {
      branchLabel,
      targetActionName,
    });
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
   * Parses and persists data on blur; empty input clears the body.
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
