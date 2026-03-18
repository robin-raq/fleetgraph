export type ShipTarget = "local" | "prod";
export type FleetMode = "on_demand" | "proactive";
export type Severity = "critical" | "warning" | "info" | "clean";

export interface RouteContext {
  pathname?: string;
  entityType?: "issue" | "project" | "program" | "sprint" | "document" | "unknown";
  entityId?: string;
}

export interface FleetRequestInput {
  mode: FleetMode;
  target: ShipTarget;
  message?: string;
  context?: RouteContext;
}

export interface Finding {
  id: string;
  category: "stale_issue" | "sprint_health";
  severity: Exclude<Severity, "clean">;
  title: string;
  detail: string;
  entityIds: string[];
}

export interface FleetResult {
  summary: string;
  severity: Severity;
  findings: Finding[];
  needsApproval: boolean;
  approvalId?: string;
  tracePath: "clean_path" | "hitl_path" | "on_demand_path";
  chatResponse?: string;
}

export interface ShipIssue {
  id: string;
  title: string;
  state?: string;
  assignee_id?: string | null;
  assignee_name?: string | null;
  updated_at?: string;
  created_at?: string;
}

export interface ShipWeek {
  id: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
}

