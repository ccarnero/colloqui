import { ComponentFixture, TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import { of } from "rxjs";
import { YoizenclawToolConfigComponent } from "./tool-config.component";
import { AdaptersService } from "../../../core/services/adapters.service";

describe("YoizenclawToolConfigComponent", () => {
  let fixture: ComponentFixture<YoizenclawToolConfigComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [YoizenclawToolConfigComponent],
      providers: [
        {
          provide: AdaptersService,
          useValue: {
            listAdapters: vi.fn().mockReturnValue(of({ adapters: [] })),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(YoizenclawToolConfigComponent);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
