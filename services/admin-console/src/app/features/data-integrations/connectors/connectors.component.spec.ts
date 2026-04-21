import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { of } from "rxjs";
import { vi } from "vitest";
import { HttpAdapterService } from "../../../core/services/http-adapter.service";
import { ConnectorsComponent } from "./connectors.component";

describe("ConnectorsComponent", () => {
  let fixture: ComponentFixture<ConnectorsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConnectorsComponent],
      providers: [
        {
          provide: HttpAdapterService,
          useValue: {
            list: vi.fn().mockReturnValue(of([])),
            get: vi.fn().mockReturnValue(of({})),
            create: vi.fn().mockReturnValue(of({})),
            update: vi.fn().mockReturnValue(of({})),
            updateEndpoint: vi.fn().mockReturnValue(of({})),
            addEndpoint: vi.fn().mockReturnValue(of({})),
            removeEndpoint: vi.fn().mockReturnValue(of(undefined)),
            remove: vi.fn().mockReturnValue(of(undefined)),
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn().mockReturnValue({
              afterClosed: () => of(undefined),
            }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConnectorsComponent);
    fixture.detectChanges();
  });

  it("renders Connectors title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Connectors");
  });
});
