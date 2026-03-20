import { Injectable, signal } from "@angular/core";
import { IActivity } from "../models";

const MOCK_ACTIVITIES: IActivity[] = [
  { color: "var(--green)", text: "alice@acme.com created new user", time: "2 min ago" },
  { color: "var(--accent)", text: 'Role "Editor" permissions updated', time: "14 min ago" },
  { color: "var(--yellow)", text: "API quota at 85% — warning sent", time: "1 hr ago" },
  { color: "var(--purple)", text: 'Workflow "Onboarding" ran 3 times', time: "2 hrs ago" },
  { color: "var(--red)", text: "Failed login attempt blocked", time: "3 hrs ago" },
];

@Injectable({ providedIn: "root" })
export class NotificationService {
  readonly notifications = signal<IActivity[]>(MOCK_ACTIVITIES);
  readonly unreadCount = signal(3);

  markAllRead(): void {
    this.unreadCount.set(0);
  }
}
