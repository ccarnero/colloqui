import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
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

interface IChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  agentId?: string;
  agentName?: string;
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
  styleUrls: ["./playground.component.scss"],
})
export class PlaygroundComponent implements OnInit {
  private readonly yoizenclawService = inject(YoizenclawAdminService);

  readonly agents = signal<IYoizenclawAgent[]>([]);
  readonly selectedAgentId = signal<string | null>(null);
  readonly selectedAgent = signal<IYoizenclawAgent | null>(null);
  readonly messages = signal<IChatMessage[]>([]);
  readonly newMessage = signal("");
  readonly loading = signal(true);
  readonly sending = signal(false);

  ngOnInit(): void {
    this.loadAgents();
  }

  async loadAgents(): Promise<void> {
    try {
      this.loading.set(true);
      const response = await firstValueFrom(
        this.yoizenclawService.listAgents(),
      );
      this.agents.set(response.agents);

      // Auto-select first published agent
      const publishedAgent = response.agents.find(
        (a: IYoizenclawAgent) => a.status === "published",
      );
      if (publishedAgent) {
        this.selectedAgentId.set(publishedAgent.id);
        this.selectedAgent.set(publishedAgent);
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

  onAgentChange(event: { value: string }): void {
    const agent = this.agents().find((a) => a.id === event.value);
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
      // Call YoizenClaw via NATS through the service
      const response = await firstValueFrom(
        this.yoizenclawService.chatWithAgent(agent.id, {
          message,
          conversationId: this.getConversationId(),
          channel: "playground",
          customerName: "Test User",
          context: this.buildContext(),
        }),
      );

      // Add assistant response
      this.messages.update((msgs) => [
        ...msgs,
        {
          role: "assistant",
          content: response.reply,
          timestamp: new Date(),
          agentId: agent.id,
          agentName: agent.name,
        },
      ]);
    } catch {
      this.messages.update((msgs) => [
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
}
