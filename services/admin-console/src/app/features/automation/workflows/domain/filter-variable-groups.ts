import type { IVariableGroup } from "../builder/components/template-autocomplete/template-autocomplete.component";

/**
 * Filters variable groups (the SAME `IVariableGroup[]` model the Variables
 * Reference panel and template-autocomplete already consume) by a search
 * string, for the conditional branch variable picker (SPEC
 * console-redesign-builder-v2 IF-editor task, idea 6). Case-insensitive
 * substring match against `path`; groups left with zero matching variables
 * are dropped rather than rendered empty. An empty/blank query returns every
 * group unchanged.
 */
export function filterVariableGroups(
  groups: readonly IVariableGroup[],
  query: string
): readonly IVariableGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return groups;
  }
  const filtered: IVariableGroup[] = [];
  for (const group of groups) {
    const variables = group.variables.filter((v) =>
      v.path.toLowerCase().includes(q)
    );
    if (variables.length > 0) {
      filtered.push({ ...group, variables });
    }
  }
  return filtered;
}
