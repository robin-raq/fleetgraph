import type { ShipTeamMember } from "./shipClient";
import type { Finding, FindingCategory, Severity, ShipIssue, ShipStandup, ShipWeek } from "./types";

const DONE_STATES = ["done", "cancelled"];

/** One-line explanation of each detector for API responses and reviewer verification docs */
export const DETECTOR_RULES: Record<FindingCategory, string> = {
  stale_issue:
    "Non-done issue with no activity for ≥3 days (or missing timestamps — treated as unknown/stale).",
  sprint_health:
    "Active sprint with ≥8 open issues and ≤3 calendar days until sprint end date.",
  unassigned_high_priority:
    "Priority is high/urgent/critical, issue is not done/cancelled, and assignee is empty.",
  missed_standup:
    "Team member listed in roster has no standup submission for the active sprint week.",
  overdue_issue:
    "Non-done issue with a due_date in the past.",
  work_distribution:
    "Assignee open-issue count exceeds 2× team mean and is at least mean+3 (team size ≥2).",
  scope_creep:
    "Active sprint with a plan: more than 2 issues in sprint were not in planned_issue_ids.",
  no_sprint_plan:
    "Active sprint has has_plan === false."
};

const HIGH_PRIORITIES = ["high", "urgent", "critical"];

export function isActiveWeek(week: ShipWeek): boolean {
  return (week.status ?? "").toLowerCase().includes("active");
}

export function toDate(dateLike?: string): Date | null {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function staleIssueFindings(issues: ShipIssue[], nowMs: number = Date.now()): Finding[] {
  const staleMs = 1000 * 60 * 60 * 24 * 3;

  return issues
    .filter((issue) => !DONE_STATES.includes((issue.state ?? "").toLowerCase()))
    .filter((issue) => {
      const updated = toDate(issue.updated_at)?.getTime() ?? toDate(issue.created_at)?.getTime();
      if (!updated) return true;
      return nowMs - updated >= staleMs;
    })
    .slice(0, 8)
    .map((issue) => {
      const label = issue.display_id ?? issue.id;
      const who = issue.assignee_name ?? "the assignee";
      return {
        id: `stale-${issue.id}`,
        category: "stale_issue" as const,
        severity: "warning" as const,
        title: `Stale issue: ${issue.title}`,
        detail: `Issue ${label} appears inactive for 3+ days and is still not done.`,
        entityIds: [issue.id],
        recommendation: `Follow up with ${who} on ${label} or re-scope if no longer needed.`
      };
    });
}

export function sprintHealthFindings(weeks: ShipWeek[], issues: ShipIssue[], nowMs: number = Date.now()): Finding[] {
  const activeWeek = weeks.find(isActiveWeek);
  if (!activeWeek) return [];

  const openIssues = issues.filter((issue) => !DONE_STATES.includes((issue.state ?? "").toLowerCase())).length;
  const endDate = toDate(activeWeek.end_date);
  if (!endDate) return [];

  const daysRemaining = Math.ceil((endDate.getTime() - nowMs) / (1000 * 60 * 60 * 24));
  if (daysRemaining > 3 || openIssues < 8) return [];

  return [
    {
      id: `sprint-health-${activeWeek.id}`,
      category: "sprint_health" as const,
      severity: "warning" as const,
      title: `Sprint health risk: ${activeWeek.title ?? activeWeek.id}`,
      detail: `${openIssues} issues are still open with ${Math.max(daysRemaining, 0)} day(s) left in the active sprint.`,
      entityIds: [activeWeek.id],
      recommendation: `Cut scope or extend sprint — ${openIssues} open issues with ${Math.max(daysRemaining, 0)} day(s) remaining.`
    }
  ];
}

export function unassignedHighPriorityFindings(issues: ShipIssue[]): Finding[] {
  return issues
    .filter((issue) => {
      const priority = (issue.priority ?? "").toLowerCase();
      const state = (issue.state ?? "").toLowerCase();
      return (
        HIGH_PRIORITIES.includes(priority) &&
        !issue.assignee_id &&
        !DONE_STATES.includes(state)
      );
    })
    .slice(0, 10)
    .map((issue) => {
      const label = issue.display_id ?? issue.id;
      return {
        id: `unassigned-hp-${issue.id}`,
        category: "unassigned_high_priority" as const,
        severity: "critical" as const,
        title: `Unassigned high-priority: ${issue.title}`,
        detail: `Issue ${label} is ${issue.priority} priority but has no assignee.`,
        entityIds: [issue.id],
        recommendation: `Assign ${label} to a team member with capacity.`
      };
    });
}

export function missedStandupFindings(
  activeWeek: ShipWeek,
  standups: ShipStandup[],
  teamMembers: { id: string; name: string }[]
): Finding[] {
  if (teamMembers.length === 0) return [];

  const submittedUserIds = new Set(standups.map((s) => s.user_id));

  return teamMembers
    .filter((member) => !submittedUserIds.has(member.id))
    .map((member) => {
      const weekLabel = activeWeek.title ?? activeWeek.id;
      return {
        id: `missed-standup-${activeWeek.id}-${member.id}`,
        category: "missed_standup" as const,
        severity: "info" as const,
        title: `Missed standup: ${member.name}`,
        detail: `${member.name} has not submitted a standup for ${weekLabel}.`,
        entityIds: [member.id, activeWeek.id],
        recommendation: `Nudge ${member.name} to submit their standup for ${weekLabel}.`
      };
    });
}

export function overdueIssueFindings(issues: ShipIssue[], nowMs: number = Date.now()): Finding[] {
  return issues
    .filter((issue) => {
      if (DONE_STATES.includes((issue.state ?? "").toLowerCase())) return false;
      const due = toDate(issue.due_date ?? undefined);
      if (!due) return false;
      return due.getTime() < nowMs;
    })
    .slice(0, 10)
    .map((issue) => {
      const due = toDate(issue.due_date ?? undefined)!;
      const daysOverdue = Math.floor((nowMs - due.getTime()) / (1000 * 60 * 60 * 24));
      const label = issue.display_id ?? issue.id;
      return {
        id: `overdue-${issue.id}`,
        category: "overdue_issue" as const,
        severity: "critical" as const,
        title: `Overdue: ${issue.title}`,
        detail: `Issue ${label} is ${daysOverdue} day(s) past its due date of ${issue.due_date}.`,
        entityIds: [issue.id],
        recommendation: `Reassign or re-scope ${label}: it is ${daysOverdue} day(s) past due.`
      };
    });
}

export function scopeCreepFindings(weeks: ShipWeek[], issues: ShipIssue[]): Finding[] {
  const activeWeek = weeks.find(isActiveWeek);
  if (!activeWeek || !activeWeek.planned_issue_ids?.length) return [];

  const plannedSet = new Set(activeWeek.planned_issue_ids);
  const sprintIssues = issues.filter((issue) =>
    issue.belongs_to?.some((b) => b.id === activeWeek.id && b.type === "sprint")
  );
  const added = sprintIssues.filter((issue) => !plannedSet.has(issue.id));

  if (added.length <= 2) return [];

  const titles = added.slice(0, 5).map((i) => i.title).join(", ");
  return [{
    id: `scope-creep-${activeWeek.id}`,
    category: "scope_creep" as const,
    severity: "warning" as const,
    title: `Scope creep: ${added.length} unplanned issues in ${activeWeek.title ?? activeWeek.id}`,
    detail: `${added.length} issues were added to ${activeWeek.title ?? activeWeek.id} after sprint planning (${plannedSet.size} originally planned).`,
    entityIds: [activeWeek.id, ...added.map((i) => i.id)],
    recommendation: `Consider deferring ${titles} to the next sprint to protect the sprint goal.`
  }];
}

export function workDistributionFindings(issues: ShipIssue[], teamMembers: ShipTeamMember[]): Finding[] {
  if (teamMembers.length < 2) return [];

  const openIssues = issues.filter((i) => !DONE_STATES.includes((i.state ?? "").toLowerCase()) && i.assignee_id);
  if (openIssues.length === 0) return [];

  const workload = new Map<string, { count: number; estimate: number; name: string }>();
  for (const member of teamMembers) {
    workload.set(member.id, { count: 0, estimate: 0, name: member.name });
  }
  for (const issue of openIssues) {
    const entry = workload.get(issue.assignee_id!);
    if (entry) {
      entry.count++;
      entry.estimate += typeof issue.estimate === "number" ? issue.estimate : 0;
    }
  }

  const entries = Array.from(workload.values());
  const mean = entries.reduce((sum, e) => sum + e.count, 0) / entries.length;
  const lightest = entries.reduce((min, e) => (e.count < min.count ? e : min), entries[0]);

  return entries
    .filter((e) => e.count > 2 * mean && e.count >= mean + 3)
    .map((e) => ({
      id: `work-dist-${e.name.toLowerCase().replace(/\s+/g, "-")}`,
      category: "work_distribution" as const,
      severity: "warning" as const,
      title: `Overloaded: ${e.name} has ${e.count} open issues`,
      detail: `${e.name} has ${e.count} open issues (~${e.estimate} pt) while the team average is ${mean.toFixed(1)}.`,
      entityIds: [] as string[],
      recommendation: `Consider reassigning issues from ${e.name} (${e.count} open, ~${e.estimate} pt) to ${lightest.name} (${lightest.count} open).`
    }));
}

export function noSprintPlanFindings(weeks: ShipWeek[]): Finding[] {
  const activeWeek = weeks.find(isActiveWeek);
  if (!activeWeek || activeWeek.has_plan !== false) return [];

  const label = activeWeek.title ?? activeWeek.id;
  return [{
    id: `no-plan-${activeWeek.id}`,
    category: "no_sprint_plan" as const,
    severity: "info" as const,
    title: `No sprint plan: ${label}`,
    detail: `${label} is active but has no sprint plan. Planning enables scope tracking and completion forecasting.`,
    entityIds: [activeWeek.id],
    recommendation: `Create a sprint plan for ${label} to enable scope tracking and completion forecasting.`
  }];
}

export function computeSeverity(findings: Finding[]): Severity {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.some((f) => f.severity === "info")) return "info";
  return "clean";
}
