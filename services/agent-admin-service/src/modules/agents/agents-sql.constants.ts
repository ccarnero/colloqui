/**
 * Shared column list for `agents` row mapping (avoid drift across SELECT/RETURNING).
 */
export const AGENT_ROW_COLUMNS =
  "id, name, description, system_prompt, model_config, tools, enabled_tools, enabled_mcp_servers, tool_description_overrides, channels, input_variables, is_active, knowledge_base_ids, output_variables, published_at, published_config, published_by, status, created_at, updated_at";
