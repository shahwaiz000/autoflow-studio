export type Status = "success" | "failed" | "running" | "queued";

export interface Execution {
  id: number; workflow_id: number; workflow_name: string; status: Status;
  trigger_type: string; started_at: string; finished_at: string | null;
  duration_seconds: number | null; error_message: string | null; is_demo: boolean;
  steps?: Step[]; inputs?: RunInput[]; result?: RunResult | null;
}
export interface RunInput { name: string; source: "samples" | "uploads"; file: string }
export interface WorkflowInput { name: string; label: string }
export interface Step {
  position: number; step_id: string; step_type: string; name: string;
  status: "success" | "failed"; attempts: number; message: string; duration_ms: number;
}
export interface Workflow {
  id: number; name: string; description: string; category: string; enabled: boolean;
  step_count: number; built_in?: boolean; run_count?: number; last_status?: Status | null; inputs?: WorkflowInput[];
  definition?: { steps: { id: string; type: string; name: string; retries?: number; next?: string; pos?: { x: number; y: number }; config: Record<string, any> }[] };
}
export interface Dashboard {
  days: number;
  totals: { reconciliations: number; runs: number; failed: number; running: number; workflows: number };
  latest: {
    execution_id: number; workflow: string; started_at: string; left: string | null; right: string | null; rows: number;
    matched_rows: number; exceptions: number; match_rate: number | null; amount_at_risk: number; by_kind: Record<string, number>;
    review: { pending: number; approved: number; rejected: number };
  } | null;
  trend: { date: string; runs: number; matched: number; exceptions: number }[];
  exceptions_by_kind: Record<string, number>;
  recent: Execution[];
  last_failure: { execution_id: number; workflow: string; reason: string | null } | null;
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

export interface DataFile {
  name: string; source: "samples" | "uploads"; rows: number | null; columns: string[]; readable: boolean;
  size_bytes: number; modified_at: string | null; used_by: string[]; sheets?: string[];
  original_name?: string | null; uploaded_at?: string | null; execution_id?: number | null;
}
export interface DataCatalog { samples: DataFile[]; uploads: DataFile[] }
export interface DataPreview { name: string; readable: boolean; columns: string[]; rows: string[][] }

export interface AuthStatus { auth_enabled: boolean; needs_setup: boolean; user: { username: string } | null }

export interface ExceptionRow {
  id: number; kind: string; key: string; left_row: number | null; right_row: number | null;
  left_amount: number | null; right_amount: number | null; difference: number | null; reason: string;
  decision: string | null; decided_by: string | null; decided_at: string | null; note: string | null;
}
export interface ExceptionList { total: number; by_kind: Record<string, number>; by_decision: { pending: number; approved: number; rejected: number }; labels: Record<string, string>; items: ExceptionRow[] }
export interface RunResult { metrics: Record<string, number>; details: Record<string, unknown> }
export interface AuditEvent { id: number; at: string; actor: string; action: string; execution_id: number | null; exception_id: number | null; key: string; detail: string }
export interface AuditList { total: number; items: AuditEvent[] }
