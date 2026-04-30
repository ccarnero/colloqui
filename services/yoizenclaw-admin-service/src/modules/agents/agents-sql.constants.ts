/**
 * Shared column list for `agents` row mapping (avoid drift across SELECT/RETURNING).
 */
export const AGENT_ROW_COLUMNS =
  "id, name, description, system_prompt, model_config, tools, channels, status, is_active, published_at, created_at, updated_at";
