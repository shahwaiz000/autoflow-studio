export type Status = "success" | "failed" | "running";

export interface Execution {
  id: number; workflow_id: number; workflow_name: string; status: Status;
  trigger_type: string; started_at: string; finished_at: string | null;
  duration_seconds: number | null; error_message: string | null; is_demo: boolean;
  steps?: Step[];
}
export interface Step {
  position: number; step_id: string; step_type: string; name: string;
  status: "success" | "failed"; attempts: number; message: string; duration_ms: number;
}
export interface Workflow {
  id: number; name: string; description: string; category: string; enabled: boolean;
  step_count: number; built_in?: boolean; run_count?: number; last_status?: Status | null;
  definition?: { steps: { id: string; type: string; name: string; retries?: number; next?: string; pos?: { x: number; y: number }; config: Record<string, any> }[] };
}
export interface Dashboard {
  totals: {
    workflows: number; enabled_workflows: number; executions: number; successful: number;
    failed: number; running: number; success_rate: number | null; avg_duration_seconds: number | null;
  };
  data_source: { demo_executions: number; live_executions: number };
  trend: { date: string; success: number; failed: number }[];
  recent: Execution[];
  workflow_performance: { workflow: string; runs: number; failed: number; avg_duration_seconds: number }[];
  failure_reasons: { reason: string; count: number }[];
}

export interface UploadResult extends Execution {
  metrics: {
    rows_loaded?: number; rows_after_cleaning?: number; invalid_rows?: number; duplicate_rows?: number;
    invalid_values?: number; missing_values?: number; missing_by_column?: Record<string, number>;
  };
}

export interface Analytics {
  days: number; source: string;
  totals: { executions: number; successful: number; failed: number; success_rate: number | null; avg_duration_seconds: number | null };
  daily: { date: string; success: number; failed: number; avg_duration_seconds: number | null }[];
  workflows: { workflow: string; runs: number; failed: number; success_rate: number; avg_duration_seconds: number }[];
  failure_reasons: { reason: string; count: number }[];
  triggers: { trigger: string; count: number }[];
}

export interface Template {
  key: string; name: string; description: string; category: string; tags: string[]; note: string; step_count: number;
  steps: { id: string; type: string; name: string; next?: string; config?: Record<string, unknown> }[];
}

export interface AssistantInfo {
  provider: string; uses_ai_model: boolean; limits: string[];
  datasets: { label: string; file: string; columns: string[] }[];
}
export interface Proposal {
  status: "ok" | "needs_detail"; request: string; message?: string;
  name?: string; description?: string; category?: string; warnings: string[];
  steps: { id: string; type: string; name: string; next?: string; retries?: number; config?: Record<string, unknown> }[];
  reasons: { step: string; why: string }[];
}
export interface Explanation {
  workflow_id: number; name: string; summary: string; suggestions: string[];
  steps: { id: string; name: string; type: string; text: string }[];
  history: { runs: number; failed: number; success_rate: number | null; last_error: string | null };
}
export interface FailureInsights {
  days: number; total_runs: number; total_failed: number; headline: string;
  items: { reason: string; count: number; workflows: string[]; example_execution_id: number | null; advice: string }[];
}

export interface Schedule {
  id: number; workflow_id: number; workflow_name: string; workflow_enabled: boolean;
  kind: "interval" | "daily" | "weekly"; interval_minutes: number | null; time_of_day: string | null;
  weekday: number | null; tz_offset_minutes: number; enabled: boolean; summary: string;
  next_run_at: string | null; last_run_at: string | null; last_status: string | null; last_execution_id: number | null;
}
export interface SchedulerStatus { running: boolean; checks_every_seconds: number; last_check: string | null; active: number; note: string }
