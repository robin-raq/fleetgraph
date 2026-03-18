import { describe, it, expect } from "vitest";
import { toDate, staleIssueFindings, sprintHealthFindings, computeSeverity } from "./detectors";
import type { Finding, ShipIssue, ShipWeek } from "./types";

// Fixed "now" for deterministic tests: 2026-03-17T12:00:00Z
const NOW = new Date("2026-03-17T12:00:00Z").getTime();

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("toDate", () => {
  it("parses a valid ISO string", () => {
    const d = toDate("2026-03-17T12:00:00Z");
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString()).toBe("2026-03-17T12:00:00.000Z");
  });

  it("returns null for undefined", () => {
    expect(toDate(undefined)).toBeNull();
  });

  it("returns null for invalid date string", () => {
    expect(toDate("not-a-date")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(toDate("")).toBeNull();
  });
});

describe("staleIssueFindings", () => {
  it("flags issues with no activity for 3+ days", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Old issue", state: "todo", updated_at: daysAgo(5) },
    ];
    const findings = staleIssueFindings(issues, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("stale_issue");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].entityIds).toContain("1");
  });

  it("ignores recently updated issues", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Fresh issue", state: "todo", updated_at: daysAgo(1) },
    ];
    const findings = staleIssueFindings(issues, NOW);
    expect(findings).toHaveLength(0);
  });

  it("ignores done issues even if stale", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Completed", state: "done", updated_at: daysAgo(10) },
    ];
    const findings = staleIssueFindings(issues, NOW);
    expect(findings).toHaveLength(0);
  });

  it("flags issues with no dates as stale", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "No dates", state: "todo" },
    ];
    const findings = staleIssueFindings(issues, NOW);
    expect(findings).toHaveLength(1);
  });

  it("caps results at 8 findings", () => {
    const issues: ShipIssue[] = Array.from({ length: 15 }, (_, i) => ({
      id: `${i}`,
      title: `Issue ${i}`,
      state: "todo",
      updated_at: daysAgo(5),
    }));
    const findings = staleIssueFindings(issues, NOW);
    expect(findings).toHaveLength(8);
  });

  it("uses created_at as fallback when updated_at is missing", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Old created", state: "todo", created_at: daysAgo(5) },
    ];
    const findings = staleIssueFindings(issues, NOW);
    expect(findings).toHaveLength(1);
  });

  it("does not flag issue updated exactly at the 3-day boundary", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Boundary", state: "todo", updated_at: daysAgo(2.9) },
    ];
    const findings = staleIssueFindings(issues, NOW);
    expect(findings).toHaveLength(0);
  });
});

describe("sprintHealthFindings", () => {
  const makeWeek = (overrides: Partial<ShipWeek> = {}): ShipWeek => ({
    id: "week-1",
    title: "Sprint 5",
    status: "active",
    start_date: daysAgo(10),
    end_date: new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
    ...overrides,
  });

  const makeOpenIssues = (count: number): ShipIssue[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `issue-${i}`,
      title: `Issue ${i}`,
      state: "todo",
    }));

  it("flags sprint with many open issues and few days left", () => {
    const weeks = [makeWeek()];
    const issues = makeOpenIssues(10);
    const findings = sprintHealthFindings(weeks, issues, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("sprint_health");
    expect(findings[0].detail).toContain("10 issues");
  });

  it("returns empty when no active sprint exists", () => {
    const weeks = [makeWeek({ status: "completed" })];
    const issues = makeOpenIssues(10);
    const findings = sprintHealthFindings(weeks, issues, NOW);
    expect(findings).toHaveLength(0);
  });

  it("returns empty when sprint has plenty of time left", () => {
    const farEnd = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString();
    const weeks = [makeWeek({ end_date: farEnd })];
    const issues = makeOpenIssues(10);
    const findings = sprintHealthFindings(weeks, issues, NOW);
    expect(findings).toHaveLength(0);
  });

  it("returns empty when few issues are open", () => {
    const weeks = [makeWeek()];
    const issues = makeOpenIssues(3);
    const findings = sprintHealthFindings(weeks, issues, NOW);
    expect(findings).toHaveLength(0);
  });

  it("excludes done and cancelled issues from open count", () => {
    const weeks = [makeWeek()];
    const issues: ShipIssue[] = [
      ...makeOpenIssues(5),
      { id: "d1", title: "Done", state: "done" },
      { id: "d2", title: "Cancelled", state: "cancelled" },
    ];
    const findings = sprintHealthFindings(weeks, issues, NOW);
    expect(findings).toHaveLength(0); // only 5 open, threshold is 8
  });
});

describe("computeSeverity", () => {
  it("returns clean when no findings", () => {
    expect(computeSeverity([])).toBe("clean");
  });

  it("returns warning when only warnings exist", () => {
    const findings: Finding[] = [
      { id: "1", category: "stale_issue", severity: "warning", title: "", detail: "", entityIds: [] },
    ];
    expect(computeSeverity(findings)).toBe("warning");
  });

  it("returns critical when any critical exists", () => {
    const findings: Finding[] = [
      { id: "1", category: "stale_issue", severity: "warning", title: "", detail: "", entityIds: [] },
      { id: "2", category: "stale_issue", severity: "critical", title: "", detail: "", entityIds: [] },
    ];
    expect(computeSeverity(findings)).toBe("critical");
  });

  it("returns info when only info findings exist", () => {
    const findings: Finding[] = [
      { id: "1", category: "stale_issue", severity: "info", title: "", detail: "", entityIds: [] },
    ];
    expect(computeSeverity(findings)).toBe("info");
  });
});
