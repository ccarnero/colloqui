import { Injectable, signal } from "@angular/core";
import { IActivity } from "../models";

@Injectable({ providedIn: "root" })
export class NotificationService {
  readonly notifications = signal<IActivity[]>([]);
  readonly unreadCount = signal(0);

  markAllRead(): void {
    this.unreadCount.set(0);
  }
}
