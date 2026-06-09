import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
  type OnInit,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatCardModule } from "@angular/material/card";
import { MatListModule } from "@angular/material/list";
import { MatChipsModule } from "@angular/material/chips";
import { firstValueFrom } from "rxjs";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import {
  AgentRuntimeService,
  type IExecutionResult,
} from "../../../core/services/agent-runtime.service";
import type { IAgent } from "../../../core/models/agent.model";

interface IChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  agentId?: string;
  agentName?: string;
  metadata?: {
    toolCalls?: Array<{ type: string; toolName: string; args?: Record<string, unknown> }>;
    toolResults?: Array<{ toolName: string; args?: Record<string, unknown>; result: unknown; success?: boolean }>;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number };
    costUsd?: number;
    model?: string;
    provider?: string;
    latencyMs?: number;
    skills?: string[];
    mcpTools?: string[];
  };
  expanded?: boolean;
}

@Component({
  selector: "app-playground",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatListModule,
    MatChipsModule,
  ],
  template: `
    <div class="playground-layout" [class.embedded]="embedded()">
      <!-- Sidebar Panel -->
      <div class="side-panel">
        <div class="panel-header">
          <mat-icon class="text-primary-icon">science</mat-icon>
          <div>
            <h2 class="m-0 text-primary-heading">Playground</h2>
            <p class="text-secondary text-sm m-0">Test your agents in real-time</p>
          </div>
        </div>
        
        <div class="panel-content">
          <div class="form-group">
            <label class="input-label">Select Agent</label>
            <mat-form-field appearance="outline" class="yz-select">
              <mat-select
                [ngModel]="selectedAgentId()"
                (ngModelChange)="onSelectedAgentIdChange($event)"
                [disabled]="loading() || lockAgentSelection()"
                panelClass="dark-theme-panel"
              >
                <mat-option *ngFor="let agent of agents()" [value]="agent.id">
                  <div class="agent-option">
                    <span>{{ agent.name }}</span>
                    <span class="status-dot" [class.published]="agent.status === 'published'"></span>
                  </div>
                </mat-option>
              </mat-select>
            </mat-form-field>
            <p class="text-muted text-xs mt-1" *ngIf="selectedAgent()">
              Model: {{ selectedAgent()?.model_config?.llm?.provider }} / {{ selectedAgent()?.model_config?.llm?.model }}
            </p>
          </div>

          <div *ngIf="selectedAgent()" class="metrics-row">
            <span class="yz-pill" [class.published]="selectedAgent()?.status === 'published'">
              {{ selectedAgent()?.status }}
            </span>
            <span class="yz-pill ghost">
              {{ selectedAgent()?.channels?.length || 0 }} channels
            </span>
            <span class="yz-pill ghost">
              {{ selectedAgent()?.tools?.length || 0 }} tools
            </span>
          </div>

          <div class="form-group">
            <label class="input-label">User ID (for testing memory)</label>
            <input
              type="text"
              class="yz-text-input"
              [(ngModel)]="userId"
              placeholder="test-user, user-123, etc."
              [disabled]="loading()"
            />
            <p class="text-muted text-xs mt-1">
              This identifies the user for conversation memory and personalization
            </p>
          </div>
        </div>
      </div>

      <!-- Chat Panel -->
      <div class="chat-panel">
        <div class="panel-header border-b">
          <mat-icon class="text-primary-icon">chat</mat-icon>
          <div>
            <h2 class="m-0 text-primary-heading">Chat</h2>
            <p class="text-secondary text-sm m-0" *ngIf="selectedAgent()">
              Chatting with {{ selectedAgent()?.name }}
            </p>
          </div>
        </div>

        <div class="messages-area" #messagesContainer>
          <div *ngIf="messages().length === 0" class="empty-state">
            <mat-icon class="empty-icon">forum</mat-icon>
            <p class="text-muted">
              {{ selectedAgent() ? 'Send a message to start the conversation' : 'Select an agent to start chatting' }}
            </p>
          </div>

          <div *ngFor="let message of messages(); trackBy: trackByMsg" 
               class="msg-wrapper"
               [class.msg-user]="message.role === 'user'"
               [class.msg-assistant]="message.role === 'assistant'"
               [class.msg-system]="message.role === 'system'">
            
            <div class="msg-avatar" *ngIf="message.role !== 'system'">
              <mat-icon *ngIf="message.role === 'user'">person</mat-icon>
              <mat-icon *ngIf="message.role === 'assistant'">smart_toy</mat-icon>
            </div>
            
            <div class="msg-bubble">
              <div class="msg-meta" *ngIf="message.role !== 'system'">
                <span class="msg-author">{{ message.role === 'user' ? 'You' : message.agentName || 'Assistant' }}</span>
                <span class="msg-time">{{ message.timestamp | date:'shortTime' }}</span>
              </div>
              <div class="msg-text">{{ message.content }}</div>
              
              <!-- Collapsible metrics section for assistant messages -->
              <div class="msg-metrics" *ngIf="message.role === 'assistant' && message.metadata">
                <button class="metrics-toggle" (click)="toggleMessage(message)">
                  <mat-icon>{{ message.expanded ? 'expand_less' : 'expand_more' }}</mat-icon>
                  <span>Details &amp; Metrics</span>
                  <span class="metrics-summary" *ngIf="!message.expanded">
                    <span *ngIf="message.metadata && message.metadata.usage">· {{ message.metadata.usage.totalTokens }} tokens</span>
                    <span *ngIf="message.metadata.toolCalls?.length">· {{ message.metadata.toolCalls?.length }} tool(s)</span>
                    <span *ngIf="message.metadata && message.metadata.costUsd">· {{ '$' + message.metadata.costUsd.toFixed(6) }}</span>
                    <span *ngIf="message.metadata.latencyMs">· {{ message.metadata.latencyMs }}ms</span>
                  </span>
                </button>
                
                <div class="metrics-content" *ngIf="message.expanded">
                  <div class="metrics-grid">
                    <div class="metric-item" *ngIf="message.metadata.usage">
                      <span class="metric-label">Tokens</span>
                      <div class="token-stats">
                        <div class="token-stat">
                          <span class="token-stat-label">In</span>
                          <span class="token-stat-value">{{ message.metadata.usage.inputTokens ?? '—' }}</span>
                        </div>
                        <div class="token-stat">
                          <span class="token-stat-label">Out</span>
                          <span class="token-stat-value">{{ message.metadata.usage.outputTokens ?? '—' }}</span>
                        </div>
                        <div class="token-stat">
                          <span class="token-stat-label">Total</span>
                          <span class="token-stat-value">{{ message.metadata.usage.totalTokens ?? '—' }}</span>
                        </div>
                      </div>
                    </div>

                    <div class="metric-item" *ngIf="message.metadata.latencyMs">
                      <span class="metric-label">Latency</span>
                      <span class="metric-value">{{ message.metadata.latencyMs }}<span class="metric-unit">ms</span></span>
                    </div>

                    <div class="metric-item" *ngIf="message.metadata.costUsd">
                      <span class="metric-label">Cost</span>
                      <span class="metric-value">$<span class="metric-number">{{ message.metadata.costUsd.toFixed(6) }}</span></span>
                    </div>

                    <div class="metric-item" *ngIf="message.metadata.model">
                      <span class="metric-label">Model</span>
                      <span class="metric-value model-value">
                        <span class="model-provider">{{ message.metadata.provider }}</span>
                        <span class="model-sep">/</span>
                        <span class="model-name">{{ message.metadata.model }}</span>
                      </span>
                    </div>

                    <div class="metric-item" *ngIf="message.metadata.toolCalls?.length">
                      <span class="metric-label">Tools</span>
                      <div class="tool-chips">
                        <span class="tool-chip" *ngFor="let tc of message.metadata.toolCalls">
                          {{ tc.toolName }}
                        </span>
                      </div>
                    </div>

                    <div class="metric-item" *ngIf="message.metadata.usage && message.metadata.usage.cachedInputTokens && message.metadata.usage.cachedInputTokens > 0">
                      <span class="metric-label">Cache</span>
                      <span class="metric-value">
                        {{ message.metadata.usage.cachedInputTokens }} tokens cached
                        <span class="cache-savings">
                          ({{ (message.metadata.usage.cachedInputTokens / (message.metadata.usage.inputTokens || 1) * 100).toFixed(0) }}% hit rate)
                        </span>
                      </span>
                    </div>

                    <div class="metric-item" *ngIf="message.metadata.skills?.length">
                      <span class="metric-label">Skills</span>
                      <div class="tool-chips">
                        <span class="skill-chip" *ngFor="let s of message.metadata.skills">{{ s }}</span>
                      </div>
                    </div>

                    <div class="metric-item" *ngIf="message.metadata.mcpTools?.length">
                      <span class="metric-label">MCP</span>
                      <div class="tool-chips">
                        <span class="mcp-chip" *ngFor="let m of message.metadata.mcpTools">{{ m }}</span>
                      </div>
                    </div>

                    <div class="metric-item" *ngIf="message.metadata.toolResults?.length" style="flex-direction: column;">
                      <span class="metric-label">Tool Details</span>
                      <div class="tool-results-list">
                        <details class="tool-result-detail" *ngFor="let tr of message.metadata.toolResults; let i = index" [style.margin-top.%]="i > 0 ? 1 : 0">
                          <summary class="tool-result-summary">
                            <span class="tool-chip">{{ tr.toolName }}</span>
                            <span class="text-muted text-xs">→ {{ formatToolResult(tr) }}</span>
                          </summary>
                          <div class="tool-result-raw">
                            <div class="raw-section">
                              <span class="raw-label">Args</span>
                              <pre class="raw-json">{{ tr.args | json }}</pre>
                            </div>
                            <div class="raw-section">
                              <span class="raw-label">Response</span>
                              <pre class="raw-json">{{ tr.result | json }}</pre>
                            </div>
                          </div>
                        </details>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div *ngIf="sending()" class="typing-indicator">
            <mat-spinner diameter="16" color="primary"></mat-spinner>
            <span>{{ selectedAgent()?.name }} is typing...</span>
          </div>
        </div>

        <div class="chat-input-area">
          <div class="yz-input-wrapper">
            <input
              type="text"
              class="yz-input"
              [(ngModel)]="newMessage"
              placeholder="Type your message..."
              [disabled]="!selectedAgent() || sending()"
              (keyup.enter)="sendMessage()"
            />
            <button class="yz-icon-btn" (click)="sendMessage()" [disabled]="!newMessage().trim() || !selectedAgent() || sending()">
              <mat-icon>send</mat-icon>
            </button>
          </div>
          <button class="yz-btn ghost-danger" (click)="clearChat()" [disabled]="messages().length === 0">
            <mat-icon>delete</mat-icon>
            <span>Clear</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styleUrl: "./playground.component.scss",
})
export class PlaygroundComponent implements OnInit {
  private readonly agentService = inject(AgentAdminService);
  private readonly agentRuntimeService = inject(AgentRuntimeService);
  private readonly route = inject(ActivatedRoute);

  readonly presetAgentId = input<string | null>(null);
  readonly lockAgentSelection = input(false);
  readonly embedded = input(false);

  readonly agents = signal<IAgent[]>([]);
  readonly selectedAgentId = signal<string | null>(null);
  readonly selectedAgent = signal<IAgent | null>(null);
  readonly messages = signal<IChatMessage[]>([]);
  readonly newMessage = signal("");
  readonly userId = signal<string>("test-user");
  readonly loading = signal(true);
  readonly sending = signal(false);

  protected trackByMsg(index: number, _msg: IChatMessage): number {
    return index;
  }

  protected toggleMessage(msg: IChatMessage): void {
    msg.expanded = !msg.expanded;
  }

  protected formatToolResult(tr: { result: unknown }): string {
    const json = JSON.stringify(tr.result) ?? "undefined";
    return json.length > 60 ? json.slice(0, 60) + "..." : json;
  }

  ngOnInit(): void {
    this.loadAgents();
  }

  async loadAgents(): Promise<void> {
    try {
      this.loading.set(true);
      const response = await firstValueFrom(
        this.agentService.listAgents({ status: "published" }),
      );
      this.agents.set(response.agents);

      const requestedAgentId = this.resolveRequestedAgentId();
      if (requestedAgentId) {
        const requestedAgent = response.agents.find(
          (agent: IAgent) => agent.id === requestedAgentId,
        );
        if (requestedAgent) {
          this.selectedAgentId.set(requestedAgent.id);
          this.selectedAgent.set(requestedAgent);
          return;
        }
      }

      // Auto-select first published agent
      const publishedAgent = response.agents.find(
        (a: IAgent) => a.status === "published",
      );
      if (publishedAgent) {
        this.selectedAgentId.set(publishedAgent.id);
        this.selectedAgent.set(publishedAgent);
        return;
      }

      const firstAgent = response.agents[0];
      if (firstAgent) {
        this.selectedAgentId.set(firstAgent.id);
        this.selectedAgent.set(firstAgent);
      }
    } catch {
      this.messages.set([
        {
          role: "system",
          content: "Failed to load agents. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      this.loading.set(false);
    }
  }

  onSelectedAgentIdChange(value: string | null): void {
    if (this.lockAgentSelection()) {
      return;
    }

    this.selectedAgentId.set(value);
    const agent = this.agents().find((a) => a.id === value);
    this.selectedAgent.set(agent || null);
    this.clearChat();
  }

  async sendMessage(): Promise<void> {
    const message = this.newMessage().trim();
    const agent = this.selectedAgent();

    if (!message || !agent) return;

    // Add user message
    this.messages.update((msgs) => [
      ...msgs,
      {
        role: "user",
        content: message,
        timestamp: new Date(),
      },
    ]);

    this.newMessage.set("");
    this.sending.set(true);

    try {
      const submitted = await firstValueFrom(
        this.agentRuntimeService.createExecution({
          agentId: agent.id,
          message,
          conversationId: this.getConversationId(),
          channel: "playground",
          customerName: "Test User",
          context: this.buildContext(),
          userId: this.userId(),
        }),
      );

      const response = await this.waitForExecution(submitted.executionId);

      // Capture timing for latency calculation
      const completedAt = response.completedAt ? new Date(response.completedAt).getTime() : Date.now();
      const startedAt = response.startedAt ? new Date(response.startedAt).getTime() : null;

      if (response.state === "failed") {
        const detail =
          response.result?.errorMessage?.trim() ||
          response.result?.errorCode?.trim() ||
          "Execution failed";
        this.messages.update((msgs) => [
          ...msgs,
          {
            role: "system",
            content: `Error: ${detail}`,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      const reply = response.result?.response ?? response.result?.reply ?? "";
      if (!reply.trim()) {
        this.messages.update((msgs) => [
          ...msgs,
          {
            role: "system",
            content: "Error: Agent returned an empty response.",
            timestamp: new Date(),
          },
        ]);
        return;
      }

      // Extract metadata from response
      const toolCalls = response.result?.toolCalls;
      const toolResults = response.result?.toolResults;
      const usage = response.result?.usage;
      const costUsd = response.result?.costUsd;
      const model = response.result?.model;
      const provider = response.result?.provider;
      const skills = response.result?.skills as string[] | undefined;
      const mcpTools = response.result?.mcpTools as string[] | undefined;

      // Add assistant response with metadata
      this.messages.update((msgs) => [
        ...msgs,
        {
          role: "assistant",
          content: reply,
          timestamp: new Date(),
          agentId: agent.id,
          agentName: agent.name,
          expanded: false,
          metadata: {
            toolCalls: toolCalls as any || undefined,
            toolResults: toolResults as any || undefined,
            usage: usage
              ? {
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  totalTokens: usage.totalTokens,
                  cachedInputTokens: (usage as any).cachedInputTokens ?? 0,
                }
              : undefined,
            costUsd,
            model,
            provider,
            latencyMs: startedAt ? completedAt - startedAt : undefined,
            skills,
            mcpTools,
          },
        },
      ]);
    } catch (error) {
      const detail =
        error instanceof Error && error.message
          ? error.message
          : "Failed to get response from agent.";
      this.messages.update((msgs) => [
        ...msgs,
        {
          role: "system",
          content: `Error: ${detail}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      this.sending.set(false);
    }
  }

  clearChat(): void {
    this.messages.set([]);
  }

  private getConversationId(): string {
    return `playground-${this.selectedAgent()?.id}-${Date.now()}`;
  }

  private async waitForExecution(
    executionId: string,
  ): Promise<IExecutionResult> {
    const timeoutAt = Date.now() + 300_000;
    while (Date.now() < timeoutAt) {
      const result = await firstValueFrom(
        this.agentRuntimeService.getExecution(executionId),
      );
      if (result.state === "completed" || result.state === "failed") {
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Execution '${executionId}' timed out`);
  }

  private buildContext(): Array<{
    sender: "customer" | "agent";
    content: string;
  }> {
    return this.messages()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        sender: m.role === "user" ? "customer" : "agent",
        content: m.content,
      }));
  }

  private resolveRequestedAgentId(): string | null {
    const byInput = this.presetAgentId();
    if (byInput && byInput.trim().length > 0) {
      return byInput;
    }

    const byQueryParam = this.route.snapshot.queryParamMap.get("agentId");
    if (byQueryParam && byQueryParam.trim().length > 0) {
      return byQueryParam;
    }

    return null;
  }
}
