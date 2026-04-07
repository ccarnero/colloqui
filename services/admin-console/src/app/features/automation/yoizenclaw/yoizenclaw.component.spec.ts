import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideMonacoEditor } from "ngx-monaco-editor-v2";
import { vi } from "vitest";
import { of } from "rxjs";
import { YoizenclawComponent } from "./yoizenclaw.component";
import { YoizenclawAdminService } from "../../../core/services/yoizenclaw-admin.service";
import { AdaptersService } from "../../../core/services/adapters.service";

describe("YoizenclawComponent", () => {
  let fixture: ComponentFixture<YoizenclawComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [YoizenclawComponent],
      providers: [
        provideMonacoEditor({ defaultOptions: {} }),
        {
          provide: YoizenclawAdminService,
          useValue: {
            listTemplates: vi
              .fn()
              .mockReturnValue(of({ templates: [] })),
            listAgents: vi.fn().mockReturnValue(of({ agents: [] })),
          },
        },
        {
          provide: AdaptersService,
          useValue: {
            listByTag: vi.fn().mockReturnValue(of([])),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(YoizenclawComponent);
    fixture.detectChanges();
  });

  it("renders YoizenClaw banner", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("YoizenClaw MVP");
  });
});
