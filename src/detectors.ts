import type { Finding, Severity, ShipIssue, ShipWeek } from "./types";

export function toDate(dateLike?: string): Date | null {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function staleIssueFindings(issues: ShipIssue[], nowMs: number = Date.now()): Finding[] {
  const staleMs = 1000 * 60 * 60 * 24 * 3;

  return issues
    .filter((issue) => (issue.state ?? "").toLowerCase() !== "done")
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
  const activeWeek = weeks.find((week) => (week.status ?? "").toLowerCase().includes("active"));
  if (!activeWeek) return [];

  const openIssues = issues.filter((issue) => !["done", "cancelled"].includes((issue.state ?? "").toLowerCase())).length;
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

export function computeSeverity(findings: Finding[]): Severity {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.some((f) => f.severity === "info")) return "info";
  return "clean";
}
