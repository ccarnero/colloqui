export interface JobDefinition {
  id: string;
  name: string;
  agent_id: string;
  schedule: string;
  schedule_type: "cron" | "interval" | "event";
  payload: Record<string, unknown>;
  is_active: boolean;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
  updated_at: string;
}
