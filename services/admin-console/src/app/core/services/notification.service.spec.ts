import { TestBed } from "@angular/core/testing";

import { NotificationService } from "./notification.service";

describe("NotificationService", () => {
  it("push prepends activity and increments unread", () => {
    TestBed.configureTestingModule({
      providers: [NotificationService],
    });
    const service = TestBed.inject(NotificationService);
    const activity = {
      color: "blue",
      text: "hello",
      time: "now",
    };
    service.push(activity);
    expect(service.notifications()).toEqual([activity]);
    expect(service.unreadCount()).toBe(1);
    service.push({ ...activity, text: "two" });
    expect(service.unreadCount()).toBe(2);
    expect(service.notifications()[0]?.text).toBe("two");
  });

  it("markAllRead clears unread count", () => {
    TestBed.configureTestingModule({
      providers: [NotificationService],
    });
    const service = TestBed.inject(NotificationService);
    service.push({
      color: "g",
      text: "t",
      time: "t",
    });
    service.markAllRead();
    expect(service.unreadCount()).toBe(0);
  });
});
