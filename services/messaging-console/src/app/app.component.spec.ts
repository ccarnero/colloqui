import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";

import { App } from "./app";
import { authGuard } from "./core/guards/auth.guard";

describe("App", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it("creates the app component", () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it("renders a router outlet", () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("router-outlet")).not.toBeNull();
  });
});

describe("authGuard", () => {
  it("is defined", () => {
    expect(authGuard).toBeDefined();
    expect(typeof authGuard).toBe("function");
  });
});
