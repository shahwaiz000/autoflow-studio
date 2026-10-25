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
