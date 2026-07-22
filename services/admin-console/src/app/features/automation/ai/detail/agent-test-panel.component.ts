import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { firstValueFrom } from "rxjs";
import {
  AgentRuntimeService,
  type IExecutionResult,
} from "../../../../core/services/agent-runtime.service";

/**
 * NEW component (T04, per the 2026-07-22 amendment): the orphaned
 * `chat-panel.component.ts` has no invoke wiring and is left untouched.
 * The invoke contract (createExecution -> poll getExecution, tokens at
 * result.usage.*, latency derived client-side from startedAt/completedAt)
 * mirrors the proven pattern in `playground.component.ts` (createExecution
 * :442-451, waitForExecution :558-572, latency calc :456-461,526) without
 * modifying that file.
 */

export interface ITestPanelTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export interface ITestPanelMetrics {
  latencyMs?: number;
  usage?: ITestPanelTokenUsage;
  toolCallCount?: number;
}

export interface ITestPanelTurn {
  role: "user" | "agent" | "error";
  content: string;
  timestamp: Date;
  metrics?: ITestPanelMetrics;
}

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 300_000;

@Component({
  selector: "app-agent-test-panel",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="test-panel">
      <div class="test-panel-header">
        <span class="status-dot" [class.running]="running()"></span>
        <span class="test-panel-title">Test run</span>
        <span class="test-panel-spacer"></span>
        @if (!agentId()) {
          <span class="test-panel-hint">Save the agent to enable testing</span>
        }
      </div>

      <div class="test-panel-turns">
        @if (turns().length === 0) {
          <div class="empty-state">
            <p>{{ agentId() ? "Send a message to test this agent" : "Save the agent first to start testing" }}</p>
          </div>
        }

        @for (turn of turns(); track $index) {
          <div
            class="turn"
            [class.turn-user]="turn.role === 'user'"
            [class.turn-agent]="turn.role === 'agent'"
            [class.turn-error]="turn.role === 'error'"
          >
            <div class="turn-bubble">{{ turn.content }}</div>

            @if (turn.role === "agent" && turn.metrics; as metrics) {
              <span class="turn-metrics">
                @if (metrics.latencyMs !== undefined) {
                  {{ metrics.latencyMs }}ms
                }
                @if (metrics.usage?.totalTokens !== undefined) {
                  &middot; {{ metrics.usage?.totalTokens }} tokens
                }
                @if (metrics.toolCallCount) {
                  &middot; {{ metrics.toolCallCount }} tool call{{ metrics.toolCallCount === 1 ? "" : "s" }}
                }
              </span>
            }
          </div>
        }

        @if (running()) {
          <div class="turn-running">
            <mat-spinner diameter="14" />
            <span>Running...</span>
          </div>
        }
      </div>

      <div class="test-panel-input">
        <input
          type="text"
          placeholder="Try the agent..."
          [(ngModel)]="draftMessage"
          [disabled]="!agentId() || running()"
          (keyup.enter)="sendMessage()"
        />
        <button
          type="button"
          class="send-btn"
          [disabled]="!draftMessage().trim() || !agentId() || running()"
          (click)="sendMessage()"
          aria-label="Send"
        >
          <mat-icon>arrow_upward</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }

    .test-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-9);
      overflow: hidden;
      background: var(--rd-panel);
    }

    .test-panel-header {
      display: flex;
      align-items: center;
      gap: var(--rd-space-4);
      padding: var(--rd-space-6) var(--rd-space-8);
      border-bottom: 1px solid var(--rd-line);
      flex-shrink: 0;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: var(--rd-radius-full);
      background: var(--rd-line-3);
    }

    .status-dot.running {
      background: var(--rd-green);
    }

    .test-panel-title {
      font-size: var(--rd-text-size-base);
      font-weight: 600;
      color: var(--rd-text-1);
    }

    .test-panel-spacer {
      flex: 1;
    }

    .test-panel-hint {
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-3);
    }

    .test-panel-turns {
      flex: 1;
      overflow-y: auto;
      padding: var(--rd-space-8);
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-6);
      min-height: 0;
    }

    .empty-state {
      margin: auto;
      text-align: center;
      color: var(--rd-text-3);
      font-size: var(--rd-text-size-base);
    }

    .turn {
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-2);
      max-width: 90%;
    }

    .turn-user {
      align-self: flex-end;
      align-items: flex-end;
    }

    .turn-agent,
    .turn-error {
      align-self: flex-start;
      align-items: flex-start;
    }

    .turn-bubble {
      padding: var(--rd-space-4) var(--rd-space-6);
      border-radius: var(--rd-radius-10);
      font-size: var(--rd-text-size-base);
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .turn-user .turn-bubble {
      background: var(--rd-accent);
      color: var(--rd-text-on-accent, #fff);
      border-bottom-right-radius: var(--rd-radius-3);
    }

    .turn-agent .turn-bubble {
      background: var(--rd-hover);
      border: 1px solid var(--rd-line-2);
      color: var(--rd-text-1);
      border-bottom-left-radius: var(--rd-radius-3);
    }

    .turn-error .turn-bubble {
      background: var(--rd-red-dim);
      border: 1px solid var(--rd-red);
      color: var(--rd-red);
      border-bottom-left-radius: var(--rd-radius-3);
    }

    .turn-metrics {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs);
      color: var(--rd-text-3);
    }

    .turn-running {
      display: flex;
      align-items: center;
      gap: var(--rd-space-4);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-3);
    }

    .test-panel-input {
      display: flex;
      gap: var(--rd-space-4);
      padding: var(--rd-space-6) var(--rd-space-7);
      border-top: 1px solid var(--rd-line);
      flex-shrink: 0;
    }

    .test-panel-input input {
      flex: 1;
      height: 34px;
      padding: 0 var(--rd-space-6);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-7);
      background: transparent;
      color: var(--rd-text-1);
      font-size: var(--rd-text-size-base);
      outline: none;
      font-family: inherit;
    }

    .test-panel-input input:focus {
      border-color: var(--rd-accent);
    }

    .test-panel-input input:disabled {
      opacity: 0.5;
    }

    .send-btn {
      width: 34px;
      height: 34px;
      border: none;
      background: var(--rd-btn-bg);
      color: var(--rd-btn-fg);
      border-radius: var(--rd-radius-7);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .send-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
  `,
})
export class AgentTestPanelComponent {
  private readonly agentRuntimeService = inject(AgentRuntimeService);
  private conversationId: string | null = null;

  readonly agentId = input<string | null>(null);

  readonly turns = signal<ITestPanelTurn[]>([]);
  readonly draftMessage = signal("");
  readonly running = signal(false);

  protected async sendMessage(): Promise<void> {
    const message = this.draftMessage().trim();
    const agentId = this.agentId();

    if (!message || !agentId || this.running()) {
      return;
    }

    console.debug("[AgentTestPanel] sending test message", {
      agentId,
      messageLength: message.length,
    });

    this.turns.update((turns) => [
      ...turns,
      { role: "user", content: message, timestamp: new Date() },
    ]);
    this.draftMessage.set("");
    this.running.set(true);

    try {
      // Invoke contract per T01 finding 5: createExecution -> poll
      // getExecution, mirrored from playground.component.ts:442-451.
      const submitted = await firstValueFrom(
        this.agentRuntimeService.createExecution({
          agentId,
          message,
          conversationId: this.getConversationId(agentId),
          channel: "test-panel",
          context: this.buildContext(),
        })
      );

      console.debug("[AgentTestPanel] execution created", {
        agentId,
        executionId: submitted.executionId,
      });

      const execution = await this.waitForExecution(submitted.executionId);
      this.handleExecutionResult(agentId, execution);
    } catch (error) {
      const detail =
        error instanceof Error && error.message
          ? error.message
          : "Failed to reach the agent runtime.";
      console.error("[AgentTestPanel] execution request failed", {
        agentId,
        error,
      });
      this.turns.update((turns) => [
        ...turns,
        { role: "error", content: `Error: ${detail}`, timestamp: new Date() },
      ]);
    } finally {
      this.running.set(false);
    }
  }

  private handleExecutionResult(
    agentId: string,
    execution: IExecutionResult
  ): void {
    // Latency is derived client-side, never returned by the backend
    // (T01 finding 5 / playground.component.ts:456-461,526).
    const startedAt = execution.startedAt
      ? new Date(execution.startedAt).getTime()
      : null;
    const completedAt = execution.completedAt
      ? new Date(execution.completedAt).getTime()
      : Date.now();
    const latencyMs = startedAt ? completedAt - startedAt : undefined;

    if (execution.state === "failed") {
      const detail =
        execution.result?.errorMessage?.trim() ||
        execution.result?.errorCode?.trim() ||
        "Execution failed";
      console.error("[AgentTestPanel] execution ended in failed state", {
        agentId,
        executionId: execution.executionId,
        detail,
      });
      this.turns.update((turns) => [
        ...turns,
        { role: "error", content: `Error: ${detail}`, timestamp: new Date() },
      ]);
      return;
    }

    const reply = execution.result?.response ?? execution.result?.reply ?? "";
    if (!reply.trim()) {
      console.error("[AgentTestPanel] execution completed with empty reply", {
        agentId,
        executionId: execution.executionId,
      });
      this.turns.update((turns) => [
        ...turns,
        {
          role: "error",
          content: "Error: Agent returned an empty response.",
          timestamp: new Date(),
        },
      ]);
      return;
    }

    // Tokens are real fields from result.usage, never invented
    // (T01 finding 5). Only fields actually present render.
    const usage = execution.result?.usage;
    const toolCallCount = execution.result?.toolCalls?.length;

    console.debug("[AgentTestPanel] execution completed", {
      agentId,
      executionId: execution.executionId,
      latencyMs,
      usage,
      toolCallCount,
    });

    this.turns.update((turns) => [
      ...turns,
      {
        role: "agent",
        content: reply,
        timestamp: new Date(),
        metrics: { latencyMs, usage, toolCallCount },
      },
    ]);
  }

  private async waitForExecution(
    executionId: string
  ): Promise<IExecutionResult> {
    const timeoutAt = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < timeoutAt) {
      const result = await firstValueFrom(
        this.agentRuntimeService.getExecution(executionId)
      );
      if (result.state === "completed" || result.state === "failed") {
        return result;
      }
      console.debug("[AgentTestPanel] execution still running, polling", {
        executionId,
        state: result.state,
      });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    console.error("[AgentTestPanel] execution polling timed out", {
      executionId,
    });
    throw new Error(`Execution '${executionId}' timed out`);
  }

  private buildContext(): Array<{
    sender: "customer" | "agent";
    content: string;
  }> {
    return this.turns()
      .filter((turn) => turn.role === "user" || turn.role === "agent")
      .map((turn) => ({
        sender: turn.role === "user" ? "customer" : "agent",
        content: turn.content,
      }));
  }

  private getConversationId(agentId: string): string {
    if (!this.conversationId) {
      this.conversationId = `test-panel-${agentId}-${Date.now()}`;
    }
    return this.conversationId;
  }
}
