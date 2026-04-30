import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { of } from "rxjs";
import { ActivatedRoute, convertToParamMap } from "@angular/router";
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
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({}),
            },
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
