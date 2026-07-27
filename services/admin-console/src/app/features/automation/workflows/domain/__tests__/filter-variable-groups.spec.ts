import type { IVariableGroup } from "../../builder/components/template-autocomplete/template-autocomplete.component";
import { filterVariableGroups } from "../filter-variable-groups";

const groups: IVariableGroup[] = [
  {
    namespace: "Request",
    icon: "📥",
    variables: [
      { path: "request.text", label: "text", description: "" },
      { path: "request.from", label: "from", description: "" },
    ],
  },
  {
    namespace: "Results",
    icon: "📊",
    variables: [
      {
        path: 'results["buildAgentContext"].data',
        label: "buildAgentContext data",
        description: "",
      },
    ],
  },
];

describe("filterVariableGroups", () => {
  it("returns every group unchanged for a blank query", () => {
    expect(filterVariableGroups(groups, "")).toEqual(groups);
  });

  it("filters variables case-insensitively by path substring", () => {
    const result = filterVariableGroups(groups, "REQUEST.TEXT");
    expect(result).toHaveLength(1);
    expect(result[0]?.namespace).toBe("Request");
    expect(result[0]?.variables).toHaveLength(1);
    expect(result[0]?.variables[0]?.path).toBe("request.text");
  });

  it("drops groups left with zero matching variables", () => {
    const result = filterVariableGroups(groups, "buildAgentContext");
    expect(result).toHaveLength(1);
    expect(result[0]?.namespace).toBe("Results");
  });

  it("returns no groups when nothing matches", () => {
    expect(filterVariableGroups(groups, "nope")).toHaveLength(0);
  });
});
