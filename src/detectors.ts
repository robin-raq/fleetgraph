import type { Finding, Severity, ShipIssue, ShipStandup, ShipWeek } from "./types";

const DONE_STATES = ["done", "cancelled"];
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
    .map((issue) => ({
      id: `stale-${issue.id}`,
      category: "stale_issue" as const,
      severity: "warning" as const,
      title: `Stale issue: ${issue.title}`,
      detail: `Issue ${issue.id} appears inactive for 3+ days and is still not done.`,
      entityIds: [issue.id]
    }));
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
      entityIds: [activeWeek.id]
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
    .map((issue) => ({
      id: `unassigned-hp-${issue.id}`,
      category: "unassigned_high_priority" as const,
      severity: "critical" as const,
      title: `Unassigned high-priority: ${issue.title}`,
      detail: `Issue ${issue.id} is ${issue.priority} priority but has no assignee.`,
      entityIds: [issue.id]
    }));
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
    .map((member) => ({
      id: `missed-standup-${activeWeek.id}-${member.id}`,
      category: "missed_standup" as const,
      severity: "info" as const,
      title: `Missed standup: ${member.name}`,
      detail: `${member.name} has not submitted a standup for ${activeWeek.title ?? activeWeek.id}.`,
      entityIds: [member.id, activeWeek.id]
    }));
}

export function computeSeverity(findings: Finding[]): Severity {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.some((f) => f.severity === "info")) return "info";
  return "clean";
}
