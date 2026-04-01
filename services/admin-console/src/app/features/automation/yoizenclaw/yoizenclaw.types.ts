import type { IYoizenclawSubagentDraft } from "../../../core/models/yoizenclaw.model";

/** Skill row for quick-insert chips and Monaco hover text. */
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

/** Tool row for quick-insert chips and Monaco hover text. */
export interface ToolInfo {
  id: string;
  name: string;
  description: string;
}

export const DEFAULT_TEMPLATE_ID = "sales-assistant";

export function cloneSubagents(
  items: IYoizenclawSubagentDraft[],
): IYoizenclawSubagentDraft[] {
  return items.map((item) => ({ ...item }));
}
