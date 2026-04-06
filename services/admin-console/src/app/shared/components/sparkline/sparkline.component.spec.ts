import { ComponentFixture, TestBed } from "@angular/core/testing";
import { SparklineComponent } from "./sparkline.component";

describe("SparklineComponent", () => {
  let fixture: ComponentFixture<SparklineComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SparklineComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SparklineComponent);
    fixture.componentRef.setInput("data", [1, 2, 3, 2, 4]);
    fixture.componentRef.setInput("color", "#4f7ef8");
    fixture.detectChanges();
  });

  it("renders svg sparkline", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("svg.sparkline")).toBeTruthy();
  });
});
