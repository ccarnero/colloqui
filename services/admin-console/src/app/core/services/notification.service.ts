import { Injectable, signal } from "@angular/core";
import type { IActivity } from "../models";

@Injectable({ providedIn: "root" })
export class NotificationService {
  readonly notifications = signal<IActivity[]>([]);
  readonly unreadCount = signal(0);

  /**
   * Appends a notification and increments unread count.
   */
  push(activity: IActivity): void {
    this.notifications.update((list) => [activity, ...list]);
    this.unreadCount.update((n) => n + 1);
  }

  markAllRead(): void {
    this.unreadCount.set(0);
  }
}
