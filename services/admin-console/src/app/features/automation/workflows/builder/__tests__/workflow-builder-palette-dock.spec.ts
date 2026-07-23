import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter, Router } from "@angular/router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EWorkflowNodeType } from "../../domain/workflow-node.types";
import { DEFAULT_NODE_MAP } from "../../domain/workflow-node-defaults";
import { WorkflowBuilderComponent } from "../workflow-builder.component";

/**
 * jsdom has no ResizeObserver; @foblex/flow's FNodeDirective/canvas
 * internals observe element size on mount. Scoped test-only stub, mirrors
 * workflow-node.component.spec.ts.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

/**
 * T03 — floating bottom-center palette dock (T01 finding 10): replaces the
 * old full-height left sidebar with one icon chip per EXISTING palette
 * entry, reusing the EXACT SAME create wiring (fExternalItem/[fData]) the
 * old sidebar used.
 */
describe("WorkflowBuilderComponent — palette dock (T03)", () => {
  let fixture: ComponentFixture<WorkflowBuilderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowBuilderComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map() }, parent: null },
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    vi.spyOn(router, "navigate").mockResolvedValue(true);

    fixture = TestBed.createComponent(WorkflowBuilderComponent);
    fixture.detectChanges();
  });

  it("renders the dock as a floating element (no full-height sidebar markup)", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('[data-testid="workflow-palette-dock"]')
    ).toBeTruthy();
    expect(el.querySelector(".palette-group")).toBeNull();
    expect(el.querySelector(".palette-item")).toBeNull();
  });

  it("renders one chip per EXISTING palette entry, in DEFAULT_NODE_MAP order", () => {
    const el = fixture.nativeElement as HTMLElement;
    const chips = Array.from(
      el.querySelectorAll<HTMLElement>('[data-testid="workflow-palette-chip"]')
    );
    const expectedTypes = Object.keys(DEFAULT_NODE_MAP);
    expect(chips.length).toBe(expectedTypes.length);
  });

  it("keeps the full node-type name as the chip's accessible tooltip/label", () => {
    const el = fixture.nativeElement as HTMLElement;
    const chips = Array.from(
      el.querySelectorAll<HTMLElement>('[data-testid="workflow-palette-chip"]')
    );
    for (const [type, defaults] of Object.entries(DEFAULT_NODE_MAP)) {
      const chip = chips.find(
        (c) => c.getAttribute("aria-label") === defaults.name
      );
      expect(chip, `chip for ${type} (${defaults.name})`).toBeTruthy();
      expect(chip!.getAttribute("title")).toBe(defaults.name);
    }
  });

  it("wires every chip with the SAME create-node mechanism (fExternalItem attribute + fData bound to the node type)", () => {
    const el = fixture.nativeElement as HTMLElement;
    const chips = Array.from(
      el.querySelectorAll<HTMLElement>('[data-testid="workflow-palette-chip"]')
    );
    // fExternalItem is a bare attribute directive (no bound value) — its
    // presence in the DOM is how @foblex/flow's fDraggable identifies a
    // valid drag source, same mechanism the old sidebar used.
    expect(chips.every((c) => c.hasAttribute("fexternalitem"))).toBe(true);
    expect(chips).toHaveLength(Object.keys(DEFAULT_NODE_MAP).length);
  });

  it("creates a node of the dropped type via the SAME onCreateNode handler as before", () => {
    const before = Object.keys(fixture.componentInstance.flow().nodes).length;

    fixture.componentInstance.onCreateNode({
      data: EWorkflowNodeType.JS_FUNCTION,
      rect: { x: 10, y: 20, width: 0, height: 0 },
      // biome-ignore lint/suspicious/noExplicitAny: minimal FCreateNodeEvent stub for this handler
    } as any);
    fixture.detectChanges();

    const nodes = Object.values(fixture.componentInstance.flow().nodes);
    expect(nodes.length).toBe(before + 1);
    expect(nodes.some((n) => n.type === EWorkflowNodeType.JS_FUNCTION)).toBe(
      true
    );
  });
});
