import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { signal } from "@angular/core";
import { NEVER } from "rxjs";
import { vi } from "vitest";

import { ShellComponent } from "./shell.component";
import { AuthService } from "../../core/services/auth.service";
import { EventStreamService } from "../../core/services/event-stream.service";

describe("ShellComponent", () => {
  let fixture: ComponentFixture<ShellComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            userProfile: signal({
              id: "u1",
              name: "User",
              email: "user@example.com",
              initials: "X",
              role: "Viewer",
            }),
            logout: vi.fn(),
          },
        },
        {
          provide: EventStreamService,
          useValue: {
            connect: () => NEVER,
            disconnect: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
  });

  it("renders header and outlet region", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("app-header")).not.toBeNull();
    expect(el.querySelector("main.shell-main")).not.toBeNull();
  });
});
