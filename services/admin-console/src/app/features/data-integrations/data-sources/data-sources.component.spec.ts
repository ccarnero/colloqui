import { ComponentFixture, TestBed } from "@angular/core/testing";
import { DataSourcesComponent } from "./data-sources.component";

describe("DataSourcesComponent", () => {
  let fixture: ComponentFixture<DataSourcesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataSourcesComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DataSourcesComponent);
    fixture.detectChanges();
  });

  it("renders Data Sources title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Data Sources");
  });
});
