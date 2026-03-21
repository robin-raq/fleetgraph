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

export type FindingCategory = "stale_issue" | "sprint_health" | "unassigned_high_priority" | "missed_standup";

export interface Finding {
  id: string;
  category: FindingCategory;
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
  tracePath: "clean_path" | "hitl_path" | "on_demand_path" | "error_path";
  chatResponse?: string;
  _debug?: {
    issueCount: number;
    weekCount: number;
    standupCount: number;
    teamMemberCount: number;
    dataChanged: boolean;
    fetchError: boolean;
  };
}

export interface ShipIssue {
  id: string;
  title: string;
  state?: string;
  priority?: string | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  updated_at?: string;
  created_at?: string;
}

export interface ShipStandup {
  id: string;
  user_id: string;
  user_name?: string;
  week_id: string;
  created_at?: string;
}

export interface ShipWeek {
  id: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
}

