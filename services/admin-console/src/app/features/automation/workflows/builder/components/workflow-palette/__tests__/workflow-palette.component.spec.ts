import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FFlowModule } from "@foblex/flow";
import { beforeEach, describe, expect, it } from "vitest";
import { EWorkflowNodeType } from "../../../../domain/workflow-node.types";
import {
  createNodeFromDefault,
  DEFAULT_NODE_MAP,
} from "../../../../domain/workflow-node-defaults";
import { WorkflowPaletteComponent } from "../workflow-palette.component";

/**
 * jsdom (the test environment) has no ResizeObserver; @foblex/flow's
 * directives observe element size on mount. Test-only stub, mirrors
 * workflow-node-card.component.spec.ts.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

/**
 * `WorkflowBuilderComponent` mounts `<app-workflow-palette />` as a SIBLING
 * of `<f-flow>`, not nested inside it (see workflow-builder.component.ts:379
 * "Sits as a sibling of <f-flow>, not inside it") — `fExternalItem`/`[fData]`
 * are drag-source directives with no FMediator dependency, so the palette
 * mounts standalone here too, matching real usage exactly.
 */
@Component({
  selector: "app-workflow-palette-test-host",
  imports: [FFlowModule, WorkflowPaletteComponent],
  template: `<app-workflow-palette />`,
})
class WorkflowPaletteTestHostComponent {}

// SPEC T05 (console-redesign-builder-v2.md) — left palette rail restyled
// per the reference, grouped by DEFAULT_NODE_MAP's `group` field.
describe("WorkflowPaletteComponent", () => {
  let fixture: ComponentFixture<WorkflowPaletteTestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowPaletteTestHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(WorkflowPaletteTestHostComponent);
    fixture.detectChanges();
  });

  function paletteComponent(): WorkflowPaletteComponent {
    const el = fixture.debugElement.query(
      (debugEl) => debugEl.componentInstance instanceof WorkflowPaletteComponent
    );
    return el.componentInstance as WorkflowPaletteComponent;
  }

  it("renders one group per distinct DEFAULT_NODE_MAP.group value, in declaration order", () => {
    const expectedGroupOrder = [
      ...new Set(Object.values(DEFAULT_NODE_MAP).map((d) => d.group)),
    ];

    const palette = paletteComponent();
    expect(palette.groups.map((g) => g.name)).toEqual(expectedGroupOrder);
  });

  it("renders every node type from DEFAULT_NODE_MAP exactly once, in its correct group", () => {
    const palette = paletteComponent();

    for (const [type, defaults] of Object.entries(DEFAULT_NODE_MAP)) {
      const group = palette.groups.find((g) => g.name === defaults.group);
      expect(group, `group "${defaults.group}" for ${type}`).toBeTruthy();
      const chip = group?.chips.find((c) => c.type === type);
      expect(
        chip,
        `chip for ${type} in group "${defaults.group}"`
      ).toBeTruthy();
    }

    const totalChips = palette.groups.reduce(
      (sum, g) => sum + g.chips.length,
      0
    );
    expect(totalChips).toBe(Object.keys(DEFAULT_NODE_MAP).length);
  });

  it("renders a divider between groups but not before the first group", () => {
    const el = fixture.nativeElement as HTMLElement;
    const dividers = el.querySelectorAll(".wf-dock-divider");
    const palette = paletteComponent();
    expect(dividers.length).toBe(palette.groups.length - 1);
  });

  it("renders a chip per node type with the same node types as DEFAULT_NODE_MAP", () => {
    const el = fixture.nativeElement as HTMLElement;
    const chips = Array.from(
      el.querySelectorAll<HTMLElement>('[data-testid="workflow-palette-chip"]')
    );
    expect(chips.length).toBe(Object.keys(DEFAULT_NODE_MAP).length);
  });

  it("wires every chip with fExternalItem + fData bound to its node type (same create wiring as before)", () => {
    const el = fixture.nativeElement as HTMLElement;
    const chips = Array.from(
      el.querySelectorAll<HTMLElement>('[data-testid="workflow-palette-chip"]')
    );
    expect(chips.every((c) => c.hasAttribute("fexternalitem"))).toBe(true);
  });

  it("each chip's bound type produces the identical node as createNodeFromDefault would for that type (not asserted against markup)", () => {
    const palette = paletteComponent();
    const position = { x: 42, y: 7 };

    for (const group of palette.groups) {
      for (const chip of group.chips) {
        const node = createNodeFromDefault(
          chip.type as EWorkflowNodeType,
          position
        );
        const expectedDefaults =
          DEFAULT_NODE_MAP[chip.type as EWorkflowNodeType];

        expect(node.type).toBe(chip.type);
        expect(node.name).toBe(expectedDefaults.name);
        expect(node.icon).toBe(expectedDefaults.icon);
        expect(node.position).toEqual(position);
        expect(node.configuration).toEqual(expectedDefaults.configuration);
        // The chip surfaces the same defaults instance used to build the
        // node, so dragging any chip creates the identical node the old
        // sidebar/dock would have for the same type.
        expect(chip.defaults).toBe(expectedDefaults);
      }
    }
  });
});
