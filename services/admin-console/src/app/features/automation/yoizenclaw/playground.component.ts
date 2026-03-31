import { Component, inject, signal, type OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
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
import { YoizenclawAdminService } from "../../../core/services/yoizenclaw-admin.service";
import type { IYoizenclawAgent } from "../../../core/models/yoizenclaw.model";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  agentId?: string;
  agentName?: string;
}

@Component({
  selector: "app-playground",
  standalone: true,
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
    <div class="playground-layout">
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
                [(ngModel)]="selectedAgentId"
                [disabled]="loading()"
                (selectionChange)="onAgentChange($event)"
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
              Model: {{ selectedAgent()?.model_config?.provider }} / {{ selectedAgent()?.model_config?.model }}
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

          <div *ngFor="let message of messages()" 
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
  styles: [`
    .playground-layout {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 24px;
      height: calc(100vh - 100px);
      padding: 24px;
    }

    .side-panel, .chat-panel {
      background: var(--bg2, #1a1a1a);
      border: 1px solid var(--border-subtle, #333);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
    }

    .panel-header {
      padding: 20px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    
    .panel-header > mat-icon {
      margin-top: 2px;
    }

    .panel-header.border-b {
      border-bottom: 1px solid var(--border-subtle, #333);
    }

    .text-primary-icon {
      color: var(--primary, #1a66ff);
    }

    .text-primary-heading {
      color: var(--text-primary, #fff);
      font-size: 1.125rem;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .text-secondary { color: var(--text2, #a0a0a0); }
    .text-muted { color: var(--text3, #777); }
    .text-sm { font-size: 0.875rem; }
    .text-xs { font-size: 0.75rem; }
    .m-0 { margin: 0; }
    .mt-1 { margin-top: 4px; }

    .panel-content {
      padding: 0 20px 20px;
    }

    .input-label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text2, #a0a0a0);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .yz-select {
      width: 100%;
    }

    ::ng-deep .yz-select .mdc-text-field--outlined {
      --mdc-outlined-text-field-container-shape: 8px;
    }

    ::ng-deep .yz-select .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }

    .agent-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
    }

    .status-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #ff9800;
      margin-left: 8px;
    }
    .status-dot.published { background-color: #4caf50; }

    .metrics-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }

    .yz-pill {
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 0.75rem;
      font-weight: 600;
      background: var(--bg3, #2a2a2a);
      color: var(--text2, #a0a0a0);
      border: 1px solid var(--border-subtle, #333);
    }
    .yz-pill.published {
      background: rgba(76, 175, 80, 0.1);
      color: #4caf50;
      border-color: rgba(76, 175, 80, 0.2);
    }

    .messages-area {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      scrollbar-width: thin;
      scrollbar-color: var(--border-subtle) transparent;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text3, #777);
      text-align: center;
    }
    .empty-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
      opacity: 0.3;
    }

    .msg-wrapper {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      max-width: 85%;
    }

    .msg-user {
      align-self: flex-end;
      flex-direction: row-reverse;
    }

    .msg-assistant {
      align-self: flex-start;
    }

    .msg-system {
      align-self: center;
      max-width: 100%;
    }

    .msg-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--bg3, #2a2a2a);
      color: var(--text2, #a0a0a0);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: 1px solid var(--border-subtle, #333);
    }

    .msg-user .msg-avatar {
      background: var(--accent-dim, rgba(26, 102, 255, 0.1));
      color: var(--primary, #1a66ff);
      border-color: transparent;
    }

    .msg-bubble {
      background: var(--bg3, #2a2a2a);
      padding: 12px 16px;
      border-radius: 16px;
      border-top-left-radius: 4px;
      border: 1px solid var(--border-subtle, #333);
    }

    .msg-user .msg-bubble {
      background: rgba(26, 102, 255, 0.1);
      border-color: rgba(26, 102, 255, 0.2);
      border-top-left-radius: 16px;
      border-top-right-radius: 4px;
    }

    .msg-system .msg-bubble {
      background: transparent;
      border: 1px dashed var(--border-subtle, #333);
      text-align: center;
      font-style: italic;
      border-radius: 8px;
    }

    .msg-meta {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 16px;
      margin-bottom: 6px;
    }

    .msg-author {
      font-weight: 600;
      font-size: 0.8125rem;
      color: var(--text-primary, #fff);
    }
    .msg-user .msg-author { color: var(--primary, #66b2ff); }

    .msg-time {
      font-size: 0.6875rem;
      color: var(--text3, #777);
    }

    .msg-text {
      color: var(--text-primary, #fff);
      font-size: 0.875rem;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .typing-indicator {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      color: var(--text3, #777);
      font-style: italic;
      font-size: 0.875rem;
    }

    .chat-input-area {
      padding: 16px;
      border-top: 1px solid var(--border-subtle, #333);
      display: flex;
      gap: 12px;
      background: var(--bg2, #1f1f1f);
      align-items: center;
    }

    .yz-input-wrapper {
      flex: 1;
      display: flex;
      background: var(--bg3, #2a2a2a);
      border: 1px solid var(--border-subtle, #333);
      border-radius: 24px;
      padding: 6px 6px 6px 16px;
      transition: border-color 0.2s;
      align-items: center;
    }

    .yz-input-wrapper:focus-within {
      border-color: var(--primary, #1a66ff);
    }

    .yz-input {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-primary, #fff);
      font-size: 0.875rem;
      outline: none;
    }
    .yz-input::placeholder { color: var(--text3, #777); }

    .yz-icon-btn {
      background: var(--primary, #1a66ff);
      color: white;
      border: none;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .yz-icon-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .yz-icon-btn:disabled { 
      background: var(--border-subtle, #333);
      color: var(--text3, #777);
      cursor: not-allowed; 
    }
    .yz-icon-btn:not(:disabled):hover { filter: brightness(1.1); }

    .yz-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 24px;
      font-weight: 500;
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .yz-btn.ghost-danger {
      background: transparent;
      border: 1px solid transparent;
      color: #f44336;
    }
    .yz-btn.ghost-danger:hover:not(:disabled) {
      background: rgba(244, 67, 54, 0.05);
      border-color: rgba(244, 67, 54, 0.2);
    }
    .yz-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    .yz-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `],
})
export class PlaygroundComponent implements OnInit {
  private readonly yoizenclawService = inject(YoizenclawAdminService);

  readonly agents = signal<IYoizenclawAgent[]>([]);
  readonly selectedAgentId = signal<string | null>(null);
  readonly selectedAgent = signal<IYoizenclawAgent | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly newMessage = signal("");
  readonly loading = signal(true);
  readonly sending = signal(false);

  ngOnInit(): void {
    this.loadAgents();
  }

  async loadAgents(): Promise<void> {
    try {
      this.loading.set(true);
      const response = await firstValueFrom(this.yoizenclawService.listAgents());
      this.agents.set(response.agents);
      
      // Auto-select first published agent
      const publishedAgent = response.agents.find((a: IYoizenclawAgent) => a.status === "published");
      if (publishedAgent) {
        this.selectedAgentId.set(publishedAgent.id);
        this.selectedAgent.set(publishedAgent);
      }
    } catch (error) {
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

  onAgentChange(event: { value: string }): void {
    const agent = this.agents().find(a => a.id === event.value);
    this.selectedAgent.set(agent || null);
    this.clearChat();
  }

  async sendMessage(): Promise<void> {
    const message = this.newMessage().trim();
    const agent = this.selectedAgent();
    
    if (!message || !agent) return;

    // Add user message
    this.messages.update(msgs => [
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
      // Call YoizenClaw via NATS through the service
      const response = await firstValueFrom(this.yoizenclawService.chatWithAgent(agent.id, {
        message,
        conversationId: this.getConversationId(),
        channel: "playground",
        customerName: "Test User",
        context: this.buildContext(),
      }));

      // Add assistant response
      this.messages.update(msgs => [
        ...msgs,
        {
          role: "assistant",
          content: response.reply,
          timestamp: new Date(),
          agentId: agent.id,
          agentName: agent.name,
        },
      ]);
    } catch (error) {
      this.messages.update(msgs => [
        ...msgs,
        {
          role: "system",
          content: "Error: Failed to get response from agent.",
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

  private buildContext(): Array<{ sender: "customer" | "agent"; content: string }> {
    return this.messages()
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({
        sender: m.role === "user" ? "customer" : "agent",
        content: m.content,
      }));
  }
}
