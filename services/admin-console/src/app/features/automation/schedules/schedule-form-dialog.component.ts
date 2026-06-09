import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { ReactiveFormsModule, FormControl, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatRadioModule } from "@angular/material/radio";
import { MatSelectModule } from "@angular/material/select";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import type { IAgent } from "../../../core/models/agent.model";
import type { IJob } from "../../../core/models/scheduler.model";

export interface IScheduleFormData {
  name: string;
  agent_id: string;
  schedule: string;
  payload: string; // JSON string
  is_active: boolean;
}

/**
 * Dialog for creating or editing a schedule (job).
 *
 * - Create mode: receives `null` via MAT_DIALOG_DATA; defaults active to true.
 * - Edit mode:  receives an `IJob` via MAT_DIALOG_DATA; pre-fills all fields.
 *
 * Returns `IScheduleFormData` on submit, `undefined` on cancel.
 */
@Component({
  selector: "app-schedule-form-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  template: `
    <h2 mat-dialog-title>
      {{ data ? "Edit Schedule" : "Create Schedule" }}
    </h2>

    <mat-dialog-content>
      <!-- Name -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Name</mat-label>
        <input matInput [formControl]="nameControl" placeholder="Daily backup" />
      </mat-form-field>

      <!-- Schedule type -->
      <label class="section-label">Trigger</label>
      <mat-radio-group [formControl]="scheduleTypeControl" class="trigger-types">
        <mat-radio-button value="cron">Cron</mat-radio-button>
        <mat-radio-button value="interval">Interval</mat-radio-button>
        <mat-radio-button value="once">Once</mat-radio-button>
      </mat-radio-group>

      @if (scheduleTypeControl.value === "cron") {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Cron Expression</mat-label>
          <input matInput [formControl]="cronExpressionControl" placeholder="0 */2 * * *" />
          <mat-hint>Examples: "0 */2 * * *" (every 2h), "0 0 * * *" (daily), "0 9 * * 1" (Mon 9am)</mat-hint>
        </mat-form-field>
      }

      @if (scheduleTypeControl.value === "interval") {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Interval (minutes)</mat-label>
          <input matInput type="number" [formControl]="intervalMinutesControl" min="1" placeholder="30" />
          <mat-hint>Run every N minutes</mat-hint>
        </mat-form-field>
      }

      @if (scheduleTypeControl.value === "once") {
        <p class="once-hint">The job will execute once immediately after creation.</p>
      }

      <!-- Agent -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Agent</mat-label>
        <mat-select [formControl]="agentIdControl" [disabled]="agentsLoading()">
          @if (agentsLoading()) {
            <mat-option disabled value="">Loading agents...</mat-option>
          } @else if (agents().length === 0) {
            <mat-option disabled value="">No published agents found</mat-option>
          } @else {
            @for (agent of agents(); track agent.id) {
              <mat-option [value]="agent.id">
                <div class="agent-option">
                  <span class="agent-name">{{ agent.name }}</span>
                  @if (agent.model_config?.model) {
                    <span class="agent-model">{{ agent.model_config.model }}</span>
                  }
                </div>
              </mat-option>
            }
          }
        </mat-select>
        @if (!agentsLoading() && agents().length > 0) {
          <mat-hint>{{ agents().length }} published agent(s) available</mat-hint>
        }
      </mat-form-field>

      <!-- Action Type -->
      <label class="section-label">Action</label>
      <mat-radio-group [formControl]="actionTypeControl" class="action-types">
        <mat-radio-button value="llm_call">LLM Call</mat-radio-button>
        <mat-radio-button value="webhook">Webhook</mat-radio-button>
        <mat-radio-button value="function">Function</mat-radio-button>
        <mat-radio-button value="agent_task">Agent Task</mat-radio-button>
      </mat-radio-group>

      @if (actionTypeControl.value === "llm_call") {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Prompt</mat-label>
          <textarea
            matInput
            [formControl]="promptControl"
            rows="3"
            placeholder="Analyze the latest data and generate a summary..."
          ></textarea>
        </mat-form-field>

        <div class="config-row">
          <mat-form-field appearance="outline" class="half-width">
            <mat-label>Model</mat-label>
            <mat-select [formControl]="modelControl">
              <mat-option value="gpt-4o-mini">gpt-4o-mini</mat-option>
              <mat-option value="gpt-4o">gpt-4o</mat-option>
              <mat-option value="gpt-4-turbo">gpt-4-turbo</mat-option>
              <mat-option value="claude-3-5-sonnet">claude-3-5-sonnet</mat-option>
              <mat-option value="claude-3-5-haiku">claude-3-5-haiku</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="quarter-width">
            <mat-label>Max Tokens</mat-label>
            <input matInput type="number" [formControl]="maxTokensControl" min="1" max="128000" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="quarter-width">
            <mat-label>Temperature</mat-label>
            <input matInput type="number" [formControl]="temperatureControl" min="0" max="2" step="0.1" />
          </mat-form-field>
        </div>
      }

      @if (actionTypeControl.value === "webhook") {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>URL</mat-label>
          <input matInput [formControl]="webhookUrlControl" placeholder="https://api.example.com/webhook" />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Method</mat-label>
          <mat-select [formControl]="webhookMethodControl">
            <mat-option value="POST">POST</mat-option>
            <mat-option value="GET">GET</mat-option>
            <mat-option value="PUT">PUT</mat-option>
            <mat-option value="PATCH">PATCH</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Headers (JSON, optional)</mat-label>
          <textarea
            matInput
            [formControl]="webhookHeadersControl"
            rows="2"
            placeholder='{"Authorization": "Bearer token"}'
          ></textarea>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Body (JSON, optional)</mat-label>
          <textarea
            matInput
            [formControl]="webhookBodyControl"
            rows="3"
            placeholder='{"key": "value"}'
          ></textarea>
        </mat-form-field>
      }

      @if (actionTypeControl.value === "function") {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Function Name</mat-label>
          <mat-select [formControl]="functionNameControl">
            <mat-option value="cleanup_old_conversations">cleanup_old_conversations</mat-option>
            <mat-option value="get_conversation_metrics">get_conversation_metrics</mat-option>
            <mat-option value="export_data">export_data</mat-option>
            <mat-option value="notify_backend">notify_backend</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Parameters (JSON, optional)</mat-label>
          <textarea
            matInput
            [formControl]="functionParamsControl"
            rows="3"
            placeholder='{"days": 30}'
          ></textarea>
        </mat-form-field>
      }

      @if (actionTypeControl.value === "agent_task") {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Task</mat-label>
          <textarea matInput [formControl]="taskControl" rows="3" placeholder="Summarize today's conversation metrics..."></textarea>
          <mat-hint>This task will be processed by the assigned agent with its full context (system prompt, tools, memory)</mat-hint>
        </mat-form-field>
      }

      <!-- Active toggle -->
      <div class="toggle-row">
        <mat-slide-toggle [formControl]="activeControl">Active</mat-slide-toggle>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-raised-button
        color="primary"
        [disabled]="formInvalid()"
        [mat-dialog-close]="formValue()"
      >
        {{ data ? "Save Changes" : "Create" }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      min-width: 420px;
      max-width: 520px;
    }
    .full-width {
      width: 100%;
      margin-bottom: 12px;
    }
    .section-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text2);
      margin-bottom: 8px;
    }
    .trigger-types {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
    }
    .action-types {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
    }
    .once-hint {
      font-size: 13px;
      color: var(--text3);
      margin: 8px 0 16px;
      padding: 8px 12px;
      background: var(--bg2);
      border-radius: 4px;
    }
    .toggle-row {
      margin: 16px 0;
    }
    .agent-option {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .agent-name {
      font-weight: 500;
    }
    .agent-model {
      font-size: 11px;
      color: var(--text3);
      background: var(--bg2);
      padding: 1px 6px;
      border-radius: 3px;
    }
    .config-row {
      display: flex;
      gap: 12px;
    }
    .half-width {
      flex: 1;
    }
    .quarter-width {
      flex: 0.5;
    }
  `,
})
export class ScheduleFormDialogComponent implements OnInit {
  private readonly dialogRef = inject<
    MatDialogRef<ScheduleFormDialogComponent, IScheduleFormData | undefined>
  >(MatDialogRef);

  private readonly agentService = inject(AgentAdminService);

  readonly data: IJob | null = inject(MAT_DIALOG_DATA);

  readonly agents = signal<IAgent[]>([]);
  readonly agentsLoading = signal(true);

  readonly nameControl = new FormControl<string>(
    this.data?.name ?? "",
    { nonNullable: true, validators: [Validators.required] },
  );

  readonly scheduleTypeControl = new FormControl<"cron" | "interval" | "once">(
    this.detectScheduleType(this.data?.schedule),
    { nonNullable: true },
  );

  readonly cronExpressionControl = new FormControl<string>(
    this.data && !this.data.schedule.startsWith("interval:") && this.data.schedule !== "once"
      ? this.data.schedule
      : "",
    { nonNullable: true, validators: [Validators.required] },
  );

  readonly intervalMinutesControl = new FormControl<number>(
    this.data?.schedule.startsWith("interval:")
      ? Number.parseInt(this.data.schedule.replace("interval:", ""), 10) || 30
      : 30,
    { nonNullable: true, validators: [Validators.required, Validators.min(1)] },
  );

  readonly agentIdControl = new FormControl<string>(
    this.data?.agent_id ?? "",
    { nonNullable: true },
  );

  readonly activeControl = new FormControl<boolean>(
    this.data?.is_active ?? true,
    { nonNullable: true },
  );

  // Action type control
  readonly actionTypeControl = new FormControl<"llm_call" | "webhook" | "function" | "agent_task">(
    this.detectActionType(this.data?.payload),
    { nonNullable: true },
  );

  // LLM Call controls
  readonly promptControl = new FormControl<string>(
    this.extractActionConfig<string>("prompt") ?? "",
    { nonNullable: true, validators: [Validators.required] },
  );
  readonly modelControl = new FormControl<string>(
    this.extractActionConfig<string>("model") ?? "gpt-4o-mini",
    { nonNullable: true },
  );
  readonly maxTokensControl = new FormControl<number>(
    this.extractActionConfig<number>("max_tokens") ?? 1000,
    { nonNullable: true },
  );
  readonly temperatureControl = new FormControl<number>(
    this.extractActionConfig<number>("temperature") ?? 0.7,
    { nonNullable: true },
  );

  // Webhook controls
  readonly webhookUrlControl = new FormControl<string>(
    this.extractActionConfig<string>("url") ?? "",
    { nonNullable: true, validators: [Validators.required] },
  );
  readonly webhookMethodControl = new FormControl<string>(
    this.extractActionConfig<string>("method") ?? "POST",
    { nonNullable: true },
  );
  readonly webhookHeadersControl = new FormControl<string>(
    this.extractActionConfig<string>("headers")
      ? JSON.stringify(this.extractActionConfig("headers"), null, 2)
      : "",
    { nonNullable: true },
  );
  readonly webhookBodyControl = new FormControl<string>(
    this.extractActionConfig<string>("body")
      ? JSON.stringify(this.extractActionConfig("body"), null, 2)
      : "",
    { nonNullable: true },
  );

  // Function controls
  readonly functionNameControl = new FormControl<string>(
    this.extractActionConfig<string>("function") ?? "",
    { nonNullable: true, validators: [Validators.required] },
  );
  readonly functionParamsControl = new FormControl<string>(
    this.extractActionConfig<string>("parameters")
      ? JSON.stringify(this.extractActionConfig("parameters"), null, 2)
      : "",
    { nonNullable: true },
  );

  // Agent Task controls
  readonly taskControl = new FormControl<string>(
    this.extractActionConfig<string>("task") ?? "",
    { nonNullable: true, validators: [Validators.required] },
  );

  private detectScheduleType(schedule?: string): "cron" | "interval" | "once" {
    if (!schedule) return "cron";
    if (schedule === "once") return "once";
    if (schedule.startsWith("interval:")) return "interval";
    return "cron";
  }

  private detectActionType(payload?: Record<string, unknown>): "llm_call" | "webhook" | "function" | "agent_task" {
    if (!payload) return "llm_call";
    const actionType = payload["action_type"];
    if (actionType === "webhook" || actionType === "function" || actionType === "agent_task") return actionType;
    return "llm_call";
  }

  private extractActionConfig<T>(key: string): T | undefined {
    const payload = this.data?.payload as Record<string, unknown> | undefined;
    const config = payload?.["action_config"] as Record<string, unknown> | undefined;
    return config?.[key] as T | undefined;
  }

  private safeParseJson(json: string): Record<string, unknown> | undefined {
    if (!json || !json.trim()) return undefined;
    try {
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  formInvalid(): boolean {
    if (this.nameControl.invalid) return true;
    if (this.scheduleTypeControl.value === "cron" && this.cronExpressionControl.invalid) return true;
    if (this.scheduleTypeControl.value === "interval" && this.intervalMinutesControl.invalid) return true;
    if (this.actionTypeControl.value === "llm_call" && this.promptControl.invalid) return true;
    if (this.actionTypeControl.value === "webhook" && this.webhookUrlControl.invalid) return true;
    if (this.actionTypeControl.value === "function" && this.functionNameControl.invalid) return true;
    if (this.actionTypeControl.value === "agent_task" && this.taskControl.invalid) return true;
    return false;
  }

  ngOnInit(): void {
    this.agentService.listAgents({ status: "published" }).subscribe({
      next: (resp) => {
        this.agents.set(resp.agents);
        this.agentsLoading.set(false);
        // Auto-select first agent if creating and no agent selected
        if (!this.data && resp.agents.length > 0 && !this.agentIdControl.value) {
          this.agentIdControl.setValue(resp.agents[0].id);
        }
      },
      error: () => this.agentsLoading.set(false),
    });
  }

  formValue(): IScheduleFormData | undefined {
    if (this.formInvalid()) return undefined;

    let schedule: string;
    if (this.scheduleTypeControl.value === "interval") {
      schedule = `interval:${this.intervalMinutesControl.value}`;
    } else if (this.scheduleTypeControl.value === "once") {
      schedule = "once";
    } else {
      schedule = this.cronExpressionControl.value;
    }

    const actionType = this.actionTypeControl.value;
    let actionConfig: Record<string, unknown> = {};

    if (actionType === "llm_call") {
      actionConfig = {
        prompt: this.promptControl.value,
        model: this.modelControl.value,
        max_tokens: this.maxTokensControl.value,
        temperature: this.temperatureControl.value,
      };
    } else if (actionType === "webhook") {
      actionConfig = {
        url: this.webhookUrlControl.value,
        method: this.webhookMethodControl.value,
        headers: this.webhookHeadersControl.value
          ? this.safeParseJson(this.webhookHeadersControl.value)
          : undefined,
        body: this.webhookBodyControl.value
          ? this.safeParseJson(this.webhookBodyControl.value)
          : undefined,
      };
    } else if (actionType === "function") {
      actionConfig = {
        function: this.functionNameControl.value,
        parameters: this.functionParamsControl.value
          ? this.safeParseJson(this.functionParamsControl.value)
          : undefined,
      };
    } else if (actionType === "agent_task") {
      actionConfig = {
        task: this.taskControl.value,
      };
    }

    const payload = JSON.stringify({
      action_type: actionType,
      action_config: actionConfig,
    });

    return {
      name: this.nameControl.value,
      schedule,
      agent_id: this.agentIdControl.value,
      payload,
      is_active: this.activeControl.value,
    };
  }
}
