import type { ISubagentDraft } from "../../../core/models/agent.model";

/** Skill row for quick-insert chips and Monaco hover text. */
export interface ISkillInfo {
  id: string;
  name: string;
  description: string;
}

/** Tool row for quick-insert chips and Monaco hover text. */
export interface IToolInfo {
  id: string;
  name: string;
  description: string;
}

export const DEFAULT_TEMPLATE_ID = "sales-assistant";

export function cloneSubagents(
  items: ISubagentDraft[],
): ISubagentDraft[] {
  return items.map((item) => ({ ...item }));
}
