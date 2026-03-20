import { Component, signal } from "@angular/core";
import { MatCardModule } from "@angular/material/card";
import { MatIconModule } from "@angular/material/icon";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";

interface ChannelRule {
  id: string;
  label: string;
  description: string;
  icon: string;
  enabled: boolean;
}

@Component({
  selector: "app-notification-rules",
  standalone: true,
  imports: [MatCardModule, MatIconModule, MatSlideToggleModule],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Notification Rules</div>
        <div class="ws-subtitle">Channels and delivery preferences</div>
      </div>
    </div>

    <div class="channel-grid">
      @for (c of channels(); track c.id) {
        <mat-card>
          <mat-card-header>
            <mat-icon mat-card-avatar>{{ c.icon }}</mat-icon>
            <mat-card-title>{{ c.label }}</mat-card-title>
            <mat-card-subtitle>{{ c.description }}</mat-card-subtitle>
          </mat-card-header>
          <mat-card-actions align="end">
            <mat-slide-toggle
              [checked]="c.enabled"
              (change)="toggle(c.id, $event.checked)"
            >
              Enabled
            </mat-slide-toggle>
          </mat-card-actions>
        </mat-card>
      }
    </div>
  `,
  styles: `
    .channel-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1rem;
    }
  `,
})
export class NotificationRulesComponent {
  readonly channels = signal<ChannelRule[]>([
    {
      id: "email",
      label: "Email",
      description: "SMTP / workspace inboxes",
      icon: "mail",
      enabled: true,
    },
    {
      id: "slack",
      label: "Slack",
      description: "#security-alerts and DMs",
      icon: "forum",
      enabled: true,
    },
    {
      id: "webhook",
      label: "Webhook",
      description: "HTTPS callbacks to your systems",
      icon: "webhook",
      enabled: false,
    },
    {
      id: "sms",
      label: "SMS",
      description: "On-call numbers (rate limited)",
      icon: "sms",
      enabled: false,
    },
  ]);

  toggle(id: string, enabled: boolean): void {
    this.channels.update((rows) =>
      rows.map((r) => (r.id === id ? { ...r, enabled } : r)),
    );
  }
}
