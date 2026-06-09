import { ComponentFixture, TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import { of } from "rxjs";
import { AiToolConfigComponent } from "./tool-config.component";
import { AdaptersService } from "../../../core/services/adapters.service";

describe("AiToolConfigComponent", () => {
  let fixture: ComponentFixture<AiToolConfigComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AiToolConfigComponent],
      providers: [
        {
          provide: AdaptersService,
          useValue: {
            listAdapters: vi.fn().mockReturnValue(of({ adapters: [] })),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AiToolConfigComponent);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
