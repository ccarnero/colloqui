// ---------------------------------------------------------------------------
// version-utils.ts — Pure functions for semantic versioning and snapshot diffing
// ---------------------------------------------------------------------------

export interface IVersionDiff {
  added: string[];
  removed: string[];
  modified: Array<{
    field: string;
    before: unknown;
    after: unknown;
  }>;
}

export type BumpType = "major" | "minor" | "patch";

// ---------------------------------------------------------------------------
// detectBumpType
// ---------------------------------------------------------------------------

/**
 * Determines the semver bump level by comparing two agent snapshots.
 * Priority: major > minor > patch.
 */
export function detectBumpType(
  previousSnapshot: Record<string, any>,
  currentSnapshot: Record<string, any>,
): BumpType {
  // ---- MAJOR triggers (breaking changes) ----

  // 1. LLM provider changed
  if (
    previousSnapshot.model_config?.llm?.provider !==
    currentSnapshot.model_config?.llm?.provider
  ) {
    return "major";
  }

  // 2. LLM model changed
  if (
    previousSnapshot.model_config?.llm?.model !==
    currentSnapshot.model_config?.llm?.model
  ) {
    return "major";
  }

  // 3. Any tool name removed
  const prevToolNames = new Set<string>(
    (previousSnapshot.tools ?? []).map((t: any) => t.name),
  );
  const currToolNames = new Set<string>(
    (currentSnapshot.tools ?? []).map((t: any) => t.name),
  );
  for (const name of prevToolNames) {
    if (!currToolNames.has(name)) return "major";
  }

  // 4. Any channel removed
  const prevChannelIds = new Set<string>(
    (previousSnapshot.channels ?? []).map((c: any) => c.id),
  );
  const currChannelIds = new Set<string>(
    (currentSnapshot.channels ?? []).map((c: any) => c.id),
  );
  for (const id of prevChannelIds) {
    if (!currChannelIds.has(id)) return "major";
  }

  // ---- MINOR triggers (additive changes) ----

  // 1. New tool added
  for (const name of currToolNames) {
    if (!prevToolNames.has(name)) return "minor";
  }

  // 2. New channel added
  for (const id of currChannelIds) {
    if (!prevChannelIds.has(id)) return "minor";
  }

  // 3. New knowledge_base_id added
  const prevKbIds = new Set<string>(previousSnapshot.knowledge_base_ids ?? []);
  const currKbIds = new Set<string>(currentSnapshot.knowledge_base_ids ?? []);
  for (const id of currKbIds) {
    if (!prevKbIds.has(id)) return "minor";
  }

  // 4. New MCP server in enabled_mcp_servers
  const prevMcp = new Set<string>(previousSnapshot.enabled_mcp_servers ?? []);
  const currMcp = new Set<string>(currentSnapshot.enabled_mcp_servers ?? []);
  for (const server of currMcp) {
    if (!prevMcp.has(server)) return "minor";
  }

  // 5. New input variable
  const prevInputVars = new Set<string>(
    (previousSnapshot.input_variables ?? []).map((v: any) => v.name),
  );
  const currInputVars = new Set<string>(
    (currentSnapshot.input_variables ?? []).map((v: any) => v.name),
  );
  for (const name of currInputVars) {
    if (!prevInputVars.has(name)) return "minor";
  }

  // 6. New output variable
  const prevOutputVars = new Set<string>(
    (previousSnapshot.output_variables ?? []).map((v: any) => v.name),
  );
  const currOutputVars = new Set<string>(
    (currentSnapshot.output_variables ?? []).map((v: any) => v.name),
  );
  for (const name of currOutputVars) {
    if (!prevOutputVars.has(name)) return "minor";
  }

  // ---- PATCH: fallback ----
  return "patch";
}

// ---------------------------------------------------------------------------
// computeSemverLabel
// ---------------------------------------------------------------------------

export function computeSemverLabel(
  major: number,
  minor: number,
  patch: number,
): string {
  return `${major}.${minor}.${patch}`;
}

// ---------------------------------------------------------------------------
// computeNextSemver
// ---------------------------------------------------------------------------

export function computeNextSemver(
  currentMajor: number,
  currentMinor: number,
  currentPatch: number,
  bumpType: BumpType,
): { major: number; minor: number; patch: number; label: string } {
  let major = currentMajor;
  let minor = currentMinor;
  let patch = currentPatch;

  switch (bumpType) {
    case "patch":
      patch++;
      break;
    case "minor":
      minor++;
      patch = 0;
      break;
    case "major":
      major++;
      minor = 0;
      patch = 0;
      break;
  }

  return {
    major,
    minor,
    patch,
    label: computeSemverLabel(major, minor, patch),
  };
}

// ---------------------------------------------------------------------------
// computeSnapshotDiff
// ---------------------------------------------------------------------------

/**
 * Computes a field-level diff between two agent snapshots.
 * When `previousSnapshot` is null (first publish), every top-level key is reported as "added".
 */
export function computeSnapshotDiff(
  previousSnapshot: Record<string, any> | null,
  currentSnapshot: Record<string, any>,
): IVersionDiff {
  const result: IVersionDiff = { added: [], removed: [], modified: [] };

  // First publish — everything is "added"
  if (previousSnapshot === null) {
    for (const key of Object.keys(currentSnapshot)) {
      result.added.push(key);
    }
    return result;
  }

  // --- Primitives ---
  comparePrimitive(
    previousSnapshot.system_prompt,
    currentSnapshot.system_prompt,
    "system_prompt",
    result,
  );
  comparePrimitive(
    previousSnapshot.description,
    currentSnapshot.description,
    "description",
    result,
  );

  // --- model_config (deep object comparison) ---
  deepCompareObjects(
    previousSnapshot.model_config,
    currentSnapshot.model_config,
    "model_config",
    result,
  );

  // --- tools (named object array) ---
  compareNamedObjectArray(
    previousSnapshot.tools ?? [],
    currentSnapshot.tools ?? [],
    "tools",
    result,
  );

  // --- channels (id-keyed object array) ---
  compareIdObjectArray(
    previousSnapshot.channels ?? [],
    currentSnapshot.channels ?? [],
    "channels",
    result,
  );

  // --- String arrays ---
  compareStringArray(
    previousSnapshot.knowledge_base_ids ?? [],
    currentSnapshot.knowledge_base_ids ?? [],
    "knowledge_base_ids",
    result,
  );
  compareStringArray(
    previousSnapshot.enabled_mcp_servers ?? [],
    currentSnapshot.enabled_mcp_servers ?? [],
    "enabled_mcp_servers",
    result,
  );

  // --- Named variable arrays ---
  compareNamedObjectArray(
    previousSnapshot.input_variables ?? [],
    currentSnapshot.input_variables ?? [],
    "input_variables",
    result,
  );
  compareNamedObjectArray(
    previousSnapshot.output_variables ?? [],
    currentSnapshot.output_variables ?? [],
    "output_variables",
    result,
  );

  // --- tool_description_overrides ---
  if (
    JSON.stringify(previousSnapshot.tool_description_overrides) !==
    JSON.stringify(currentSnapshot.tool_description_overrides)
  ) {
    result.modified.push({
      field: "tool_description_overrides",
      before: previousSnapshot.tool_description_overrides,
      after: currentSnapshot.tool_description_overrides,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// computeVersionNumber
// ---------------------------------------------------------------------------

/**
 * Encodes a semver triple as a single monotonically-increasing integer.
 * Formula: major * 10000 + minor * 100 + patch
 */
export function computeVersionNumber(
  major: number,
  minor: number,
  patch: number,
): number {
  return major * 10000 + minor * 100 + patch;
}

// ===========================================================================
// Internal helpers
// ===========================================================================

function comparePrimitive(
  prev: unknown,
  curr: unknown,
  field: string,
  result: IVersionDiff,
): void {
  if (prev !== curr) {
    result.modified.push({ field, before: prev, after: curr });
  }
}

function deepCompareObjects(
  prev: any,
  curr: any,
  prefix: string,
  result: IVersionDiff,
): void {
  if (prev === curr) return;

  // Leaf values or type mismatch → single modified entry
  if (
    prev === null ||
    curr === null ||
    typeof prev !== "object" ||
    typeof curr !== "object" ||
    Array.isArray(prev) ||
    Array.isArray(curr)
  ) {
    result.modified.push({ field: prefix, before: prev, after: curr });
    return;
  }

  // Both are plain objects → recurse per key
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  for (const key of allKeys) {
    const path = `${prefix}.${key}`;
    if (!(key in prev)) {
      result.added.push(path);
    } else if (!(key in curr)) {
      result.removed.push(path);
    } else {
      deepCompareObjects(prev[key], curr[key], path, result);
    }
  }
}

/**
 * Compares arrays of objects identified by a `name` property.
 * Reports added/removed by index position; modified by name key.
 */
function compareNamedObjectArray(
  prev: Array<Record<string, any>>,
  curr: Array<Record<string, any>>,
  fieldName: string,
  result: IVersionDiff,
): void {
  const prevByName = new Map(
    prev.map((item, i) => [item.name as string, { item, index: i }]),
  );
  const currByName = new Map(
    curr.map((item, i) => [item.name as string, { item, index: i }]),
  );

  // Added — index in current array
  for (const [name, { index }] of currByName) {
    if (!prevByName.has(name)) {
      result.added.push(`${fieldName}[${index}]`);
    }
  }

  // Removed — index in previous array
  for (const [name, { index }] of prevByName) {
    if (!currByName.has(name)) {
      result.removed.push(`${fieldName}[${index}]`);
    }
  }

  // Modified — same name, different content
  for (const [name, { item: prevItem }] of prevByName) {
    const currEntry = currByName.get(name);
    if (currEntry && JSON.stringify(prevItem) !== JSON.stringify(currEntry.item)) {
      result.modified.push({
        field: `${fieldName}[${name}]`,
        before: prevItem,
        after: currEntry.item,
      });
    }
  }
}

/**
 * Compares arrays of objects identified by an `id` property.
 * Same logic as compareNamedObjectArray but keyed by `id`.
 */
function compareIdObjectArray(
  prev: Array<Record<string, any>>,
  curr: Array<Record<string, any>>,
  fieldName: string,
  result: IVersionDiff,
): void {
  const prevById = new Map(
    prev.map((item, i) => [item.id as string, { item, index: i }]),
  );
  const currById = new Map(
    curr.map((item, i) => [item.id as string, { item, index: i }]),
  );

  for (const [id, { index }] of currById) {
    if (!prevById.has(id)) {
      result.added.push(`${fieldName}[${index}]`);
    }
  }

  for (const [id, { index }] of prevById) {
    if (!currById.has(id)) {
      result.removed.push(`${fieldName}[${index}]`);
    }
  }

  for (const [id, { item: prevItem }] of prevById) {
    const currEntry = currById.get(id);
    if (currEntry && JSON.stringify(prevItem) !== JSON.stringify(currEntry.item)) {
      result.modified.push({
        field: `${fieldName}[${id}]`,
        before: prevItem,
        after: currEntry.item,
      });
    }
  }
}

/**
 * Compares arrays of primitives (strings).
 * Reports added/removed by index position.
 */
function compareStringArray(
  prev: string[],
  curr: string[],
  fieldName: string,
  result: IVersionDiff,
): void {
  const prevSet = new Set(prev);
  const currSet = new Set(curr);

  for (let i = 0; i < curr.length; i++) {
    if (!prevSet.has(curr[i])) {
      result.added.push(`${fieldName}[${i}]`);
    }
  }

  for (let i = 0; i < prev.length; i++) {
    if (!currSet.has(prev[i])) {
      result.removed.push(`${fieldName}[${i}]`);
    }
  }
}
