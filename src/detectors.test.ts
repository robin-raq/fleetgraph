import { describe, it, expect } from "vitest";
import {
  toDate,
  staleIssueFindings,
  sprintHealthFindings,
  unassignedHighPriorityFindings,
  missedStandupFindings,
  overdueIssueFindings,
  workDistributionFindings,
  scopeCreepFindings,
  noSprintPlanFindings,
  computeSeverity
} from "./detectors";
import type { Finding, ShipIssue, ShipStandup, ShipWeek } from "./types";
import type { ShipTeamMember } from "./shipClient";

// Fixed "now" for deterministic tests: 2026-03-17T12:00:00Z
const NOW = new Date("2026-03-17T12:00:00Z").getTime();

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

function daysFromNow(days: number): string {
  return new Date(NOW + days * 24 * 60 * 60 * 1000).toISOString();
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

// ─────────────────────────────────────────────
// Unassigned High-Priority Detector
// ─────────────────────────────────────────────

describe("unassignedHighPriorityFindings", () => {
  it("flags high-priority issues with no assignee", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Critical bug", state: "todo", priority: "high", assignee_id: null },
    ];
    const findings = unassignedHighPriorityFindings(issues);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("unassigned_high_priority");
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].entityIds).toContain("1");
  });

  it("flags urgent-priority issues with no assignee", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Prod down", state: "todo", priority: "urgent", assignee_id: null },
    ];
    const findings = unassignedHighPriorityFindings(issues);
    expect(findings).toHaveLength(1);
  });

  it("ignores high-priority issues that have an assignee", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Has owner", state: "todo", priority: "high", assignee_id: "user-1", assignee_name: "Alice" },
    ];
    const findings = unassignedHighPriorityFindings(issues);
    expect(findings).toHaveLength(0);
  });

  it("ignores low/medium priority unassigned issues", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Nice to have", state: "todo", priority: "low", assignee_id: null },
      { id: "2", title: "Medium task", state: "todo", priority: "medium", assignee_id: null },
    ];
    const findings = unassignedHighPriorityFindings(issues);
    expect(findings).toHaveLength(0);
  });

  it("ignores done issues even if high priority and unassigned", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Already done", state: "done", priority: "high", assignee_id: null },
    ];
    const findings = unassignedHighPriorityFindings(issues);
    expect(findings).toHaveLength(0);
  });

  it("handles missing priority gracefully (no flag)", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "No priority", state: "todo", assignee_id: null },
    ];
    const findings = unassignedHighPriorityFindings(issues);
    expect(findings).toHaveLength(0);
  });

  it("is case-insensitive for priority values", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "CAPS", state: "todo", priority: "HIGH", assignee_id: null },
    ];
    const findings = unassignedHighPriorityFindings(issues);
    expect(findings).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────
// Missed Standup Detector
// ─────────────────────────────────────────────

describe("missedStandupFindings", () => {
  const teamMembers = [
    { id: "user-1", name: "Alice" },
    { id: "user-2", name: "Bob" },
    { id: "user-3", name: "Charlie" },
  ];

  const activeWeek: ShipWeek = {
    id: "week-1",
    title: "Sprint 5",
    status: "active",
    start_date: daysAgo(5),
    end_date: new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString(),
  };

  it("flags team members who have not submitted a standup", () => {
    const standups: ShipStandup[] = [
      { id: "s1", user_id: "user-1", user_name: "Alice", week_id: "week-1" },
      // Bob and Charlie missing
    ];
    const findings = missedStandupFindings(activeWeek, standups, teamMembers);
    expect(findings).toHaveLength(2);
    expect(findings[0].category).toBe("missed_standup");
    expect(findings[0].severity).toBe("info");
    expect(findings.some((f) => f.title.includes("Bob"))).toBe(true);
    expect(findings.some((f) => f.title.includes("Charlie"))).toBe(true);
  });

  it("returns empty when everyone submitted standups", () => {
    const standups: ShipStandup[] = [
      { id: "s1", user_id: "user-1", user_name: "Alice", week_id: "week-1" },
      { id: "s2", user_id: "user-2", user_name: "Bob", week_id: "week-1" },
      { id: "s3", user_id: "user-3", user_name: "Charlie", week_id: "week-1" },
    ];
    const findings = missedStandupFindings(activeWeek, standups, teamMembers);
    expect(findings).toHaveLength(0);
  });

  it("returns empty when team is empty", () => {
    const standups: ShipStandup[] = [];
    const findings = missedStandupFindings(activeWeek, standups, []);
    expect(findings).toHaveLength(0);
  });

  it("flags all members when no standups exist", () => {
    const findings = missedStandupFindings(activeWeek, [], teamMembers);
    expect(findings).toHaveLength(3);
  });

  it("includes the week title in finding detail", () => {
    const findings = missedStandupFindings(activeWeek, [], teamMembers);
    expect(findings[0].detail).toContain("Sprint 5");
  });
});

// ─────────────────────────────────────────────
// Overdue Issue Detector
// ─────────────────────────────────────────────

describe("overdueIssueFindings", () => {
  it("flags issue past due_date", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Late task", state: "todo", due_date: daysAgo(2), display_id: "#27" },
    ];
    const findings = overdueIssueFindings(issues, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("overdue_issue");
    expect(findings[0].severity).toBe("critical");
  });

  it("ignores done issues even if overdue", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Done task", state: "done", due_date: daysAgo(5) },
    ];
    expect(overdueIssueFindings(issues, NOW)).toHaveLength(0);
  });

  it("ignores cancelled issues even if overdue", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Cancelled task", state: "cancelled", due_date: daysAgo(5) },
    ];
    expect(overdueIssueFindings(issues, NOW)).toHaveLength(0);
  });

  it("ignores issues with no due_date", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "No due", state: "todo", due_date: null },
      { id: "2", title: "No field", state: "todo" },
    ];
    expect(overdueIssueFindings(issues, NOW)).toHaveLength(0);
  });

  it("ignores issues with future due_date", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Future task", state: "todo", due_date: daysFromNow(3) },
    ];
    expect(overdueIssueFindings(issues, NOW)).toHaveLength(0);
  });

  it("boundary: due_date exactly now is not overdue", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Due now", state: "todo", due_date: new Date(NOW).toISOString() },
    ];
    expect(overdueIssueFindings(issues, NOW)).toHaveLength(0);
  });

  it("caps at 10 findings", () => {
    const issues: ShipIssue[] = Array.from({ length: 15 }, (_, i) => ({
      id: `issue-${i}`, title: `Overdue ${i}`, state: "todo", due_date: daysAgo(i + 1)
    }));
    expect(overdueIssueFindings(issues, NOW)).toHaveLength(10);
  });

  it("includes recommendation with display_id", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Late", state: "todo", due_date: daysAgo(3), display_id: "#42" },
    ];
    const findings = overdueIssueFindings(issues, NOW);
    expect(findings[0].recommendation).toBeDefined();
    expect(findings[0].recommendation).toContain("#42");
    expect(findings[0].recommendation).toContain("3");
  });

  it("uses id when display_id is missing", () => {
    const issues: ShipIssue[] = [
      { id: "abc-123", title: "Late", state: "todo", due_date: daysAgo(1) },
    ];
    const findings = overdueIssueFindings(issues, NOW);
    expect(findings[0].recommendation).toContain("abc-123");
  });
});

// ─────────────────────────────────────────────
// Work Distribution Detector
// ─────────────────────────────────────────────

describe("workDistributionFindings", () => {
  const team: ShipTeamMember[] = [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
    { id: "charlie", name: "Charlie" },
  ];

  function makeIssues(assigneeCounts: Record<string, number>): ShipIssue[] {
    const issues: ShipIssue[] = [];
    for (const [assignee_id, count] of Object.entries(assigneeCounts)) {
      for (let i = 0; i < count; i++) {
        issues.push({
          id: `${assignee_id}-${i}`,
          title: `Task ${i}`,
          state: "todo",
          assignee_id,
          assignee_name: assignee_id.charAt(0).toUpperCase() + assignee_id.slice(1),
          estimate: 3
        });
      }
    }
    return issues;
  }

  it("flags overloaded member when count > 2x mean and 3+ above mean", () => {
    // Alice: 9, Bob: 2, Charlie: 1 → mean ~4, Alice is 9 (>2x4 and 5 above mean)
    const issues = makeIssues({ alice: 9, bob: 2, charlie: 1 });
    const findings = workDistributionFindings(issues, team);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("work_distribution");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].title).toContain("Alice");
  });

  it("does not flag balanced team", () => {
    const issues = makeIssues({ alice: 3, bob: 3, charlie: 4 });
    expect(workDistributionFindings(issues, team)).toHaveLength(0);
  });

  it("excludes done issues from count", () => {
    const issues = [
      ...makeIssues({ alice: 4, bob: 2, charlie: 1 }),
      // Add 5 done issues for Alice — shouldn't count
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `alice-done-${i}`, title: "Done", state: "done", assignee_id: "alice"
      } as ShipIssue))
    ];
    expect(workDistributionFindings(issues, team)).toHaveLength(0);
  });

  it("returns empty with single team member", () => {
    const issues = makeIssues({ alice: 10 });
    expect(workDistributionFindings(issues, [team[0]])).toHaveLength(0);
  });

  it("returns empty when all issues are unassigned", () => {
    const issues: ShipIssue[] = Array.from({ length: 5 }, (_, i) => ({
      id: `u-${i}`, title: `Task ${i}`, state: "todo", assignee_id: null
    }));
    expect(workDistributionFindings(issues, team)).toHaveLength(0);
  });

  it("recommendation names the lightest member", () => {
    const issues = makeIssues({ alice: 9, bob: 1, charlie: 2 });
    const findings = workDistributionFindings(issues, team);
    expect(findings[0].recommendation).toContain("Bob");
  });

  it("includes estimate totals in recommendation when available", () => {
    const issues = makeIssues({ alice: 9, bob: 1, charlie: 1 });
    const findings = workDistributionFindings(issues, team);
    expect(findings[0].recommendation).toContain("pt");
  });
});

// ─────────────────────────────────────────────
// Scope Creep Detector
// ─────────────────────────────────────────────

describe("scopeCreepFindings", () => {
  const activeWeek: ShipWeek = {
    id: "week-1",
    title: "Sprint 15",
    status: "active",
    start_date: daysAgo(5),
    end_date: daysFromNow(2),
    planned_issue_ids: ["i-1", "i-2", "i-3"]
  };

  function sprintIssue(id: string, title: string): ShipIssue {
    return {
      id, title, state: "todo",
      belongs_to: [{ id: "week-1", type: "sprint", title: "Sprint 15" }]
    };
  }

  it("detects scope creep when >2 issues added after planning", () => {
    const issues = [
      sprintIssue("i-1", "Planned 1"), sprintIssue("i-2", "Planned 2"), sprintIssue("i-3", "Planned 3"),
      sprintIssue("i-4", "Added 1"), sprintIssue("i-5", "Added 2"), sprintIssue("i-6", "Added 3"),
    ];
    const findings = scopeCreepFindings([activeWeek], issues);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("scope_creep");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].detail).toContain("3");
  });

  it("tolerates <= 2 extra issues (normal)", () => {
    const issues = [
      sprintIssue("i-1", "P1"), sprintIssue("i-2", "P2"), sprintIssue("i-3", "P3"),
      sprintIssue("i-4", "Added 1"),
    ];
    expect(scopeCreepFindings([activeWeek], issues)).toHaveLength(0);
  });

  it("returns empty when no planned_issue_ids", () => {
    const weekNoPlan: ShipWeek = { ...activeWeek, planned_issue_ids: undefined };
    const issues = [sprintIssue("i-1", "P1"), sprintIssue("i-4", "Added")];
    expect(scopeCreepFindings([weekNoPlan], issues)).toHaveLength(0);
  });

  it("returns empty when no active week", () => {
    const completedWeek: ShipWeek = { ...activeWeek, status: "completed" };
    expect(scopeCreepFindings([completedWeek], [])).toHaveLength(0);
  });

  it("recommendation lists added issue titles", () => {
    const issues = [
      sprintIssue("i-1", "P1"), sprintIssue("i-2", "P2"), sprintIssue("i-3", "P3"),
      sprintIssue("i-4", "Bug fix"), sprintIssue("i-5", "Hotfix"), sprintIssue("i-6", "Extra"),
    ];
    const findings = scopeCreepFindings([activeWeek], issues);
    expect(findings[0].recommendation).toContain("Bug fix");
  });
});

// ─────────────────────────────────────────────
// No Sprint Plan Detector
// ─────────────────────────────────────────────

describe("noSprintPlanFindings", () => {
  it("flags active sprint with has_plan false", () => {
    const weeks: ShipWeek[] = [{ id: "w1", title: "Sprint 15", status: "active", has_plan: false }];
    const findings = noSprintPlanFindings(weeks);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("no_sprint_plan");
    expect(findings[0].severity).toBe("info");
    expect(findings[0].recommendation).toContain("Sprint 15");
  });

  it("no finding when has_plan is true", () => {
    const weeks: ShipWeek[] = [{ id: "w1", title: "Sprint 15", status: "active", has_plan: true }];
    expect(noSprintPlanFindings(weeks)).toHaveLength(0);
  });

  it("no finding when has_plan is undefined (graceful)", () => {
    const weeks: ShipWeek[] = [{ id: "w1", title: "Sprint 15", status: "active" }];
    expect(noSprintPlanFindings(weeks)).toHaveLength(0);
  });

  it("no finding when no active week", () => {
    const weeks: ShipWeek[] = [{ id: "w1", title: "Sprint 14", status: "completed", has_plan: false }];
    expect(noSprintPlanFindings(weeks)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// Existing detectors: recommendation field
// ─────────────────────────────────────────────

describe("recommendation field on existing detectors", () => {
  it("staleIssueFindings includes recommendation", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Old task", state: "todo", updated_at: daysAgo(5), assignee_name: "Alice", display_id: "#10" }
    ];
    const findings = staleIssueFindings(issues, NOW);
    expect(findings[0].recommendation).toBeDefined();
    expect(findings[0].recommendation).toContain("Alice");
    expect(findings[0].recommendation).toContain("#10");
  });

  it("sprintHealthFindings includes recommendation", () => {
    const week: ShipWeek = { id: "w1", title: "Sprint 5", status: "active", end_date: new Date(NOW + 1 * 24 * 60 * 60 * 1000).toISOString() };
    const issues: ShipIssue[] = Array.from({ length: 10 }, (_, i) => ({ id: `i-${i}`, title: `Task ${i}`, state: "todo" }));
    const findings = sprintHealthFindings([week], issues, NOW);
    expect(findings[0].recommendation).toBeDefined();
    expect(findings[0].recommendation).toContain("10");
  });

  it("unassignedHighPriorityFindings includes recommendation", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "P0 bug", state: "todo", priority: "critical", assignee_id: null, display_id: "#5" }
    ];
    const findings = unassignedHighPriorityFindings(issues);
    expect(findings[0].recommendation).toBeDefined();
    expect(findings[0].recommendation).toContain("#5");
  });

  it("missedStandupFindings includes recommendation", () => {
    const week: ShipWeek = { id: "w1", title: "Sprint 5", status: "active" };
    const findings = missedStandupFindings(week, [], [{ id: "u1", name: "Bob" }]);
    expect(findings[0].recommendation).toBeDefined();
    expect(findings[0].recommendation).toContain("Bob");
    expect(findings[0].recommendation).toContain("Sprint 5");
  });
});
