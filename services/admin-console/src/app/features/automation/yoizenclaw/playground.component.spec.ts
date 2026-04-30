import { ComponentFixture, TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import { of } from "rxjs";
import { PlaygroundComponent } from "./playground.component";
import { YoizenclawAdminService } from "../../../core/services/yoizenclaw-admin.service";

describe("PlaygroundComponent", () => {
  let fixture: ComponentFixture<PlaygroundComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlaygroundComponent],
      providers: [
        {
          provide: YoizenclawAdminService,
          useValue: {
            listAgents: vi.fn().mockReturnValue(of({ agents: [] })),
            chatWithAgent: vi
              .fn()
              .mockReturnValue(of({ reply: "ok", tool_calls: [] })),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlaygroundComponent);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
