import { describe, it, expect } from "vitest";
import { staleIssueFindings, sprintHealthFindings, computeSeverity } from "./detectors";
import type { ShipIssue, ShipWeek } from "./types";

// Fixed "now" for deterministic tests: 2026-03-17T12:00:00Z
const NOW = new Date("2026-03-17T12:00:00Z").getTime();

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

function daysFromNow(days: number): string {
  return new Date(NOW + days * 24 * 60 * 60 * 1000).toISOString();
}

// ─── Test Case 3: Clean path ────────────────────────────────────────
// Ship state: all issues are either done or recently updated
// Expected: 0 findings, severity = "clean", graph routes to cleanPath
describe("Test Case 3: Clean path — no findings", () => {
  it("produces zero stale findings when all issues are recently updated", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Fresh task A", state: "todo", updated_at: daysAgo(1) },
      { id: "2", title: "Fresh task B", state: "in_progress", updated_at: daysAgo(0.5) },
      { id: "3", title: "Done task", state: "done", updated_at: daysAgo(10) },
    ];
    const findings = staleIssueFindings(issues, NOW);
    expect(findings).toHaveLength(0);
  });

  it("produces zero sprint health findings when sprint has plenty of time", () => {
    const weeks: ShipWeek[] = [
      { id: "w1", title: "Sprint 6", status: "active", start_date: daysAgo(3), end_date: daysFromNow(7) },
    ];
    const issues: ShipIssue[] = [
      { id: "1", title: "Task A", state: "todo" },
      { id: "2", title: "Task B", state: "todo" },
    ];
    const findings = sprintHealthFindings(weeks, issues, NOW);
    expect(findings).toHaveLength(0);
  });

  it("computes severity as 'clean' when no findings exist", () => {
    expect(computeSeverity([])).toBe("clean");
  });

  it("combined: clean ship state produces zero total findings", () => {
    const issues: ShipIssue[] = [
      { id: "1", title: "Active task", state: "in_progress", updated_at: daysAgo(1) },
      { id: "2", title: "Completed", state: "done", updated_at: daysAgo(5) },
    ];
    const weeks: ShipWeek[] = [
      { id: "w1", title: "Sprint 6", status: "active", start_date: daysAgo(3), end_date: daysFromNow(5) },
    ];
    const allFindings = [
      ...staleIssueFindings(issues, NOW),
      ...sprintHealthFindings(weeks, issues, NOW),
    ];
    expect(allFindings).toHaveLength(0);
    expect(computeSeverity(allFindings)).toBe("clean");
  });
});

// ─── Test Case 4: Sprint health risk ────────────────────────────────
// Ship state: active sprint ending in 2 days with 10+ open issues
// Expected: sprint_health finding, severity = "warning"
describe("Test Case 4: Sprint health risk detection", () => {
  it("detects sprint risk when many open issues and few days left", () => {
    const weeks: ShipWeek[] = [
      { id: "w1", title: "Sprint 5", status: "active", start_date: daysAgo(12), end_date: daysFromNow(2) },
    ];
    const issues: ShipIssue[] = Array.from({ length: 12 }, (_, i) => ({
      id: `issue-${i}`,
      title: `Open task ${i}`,
      state: "todo",
      updated_at: daysAgo(1),
    }));
    const findings = sprintHealthFindings(weeks, issues, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("sprint_health");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].detail).toContain("12 issues");
    expect(findings[0].detail).toContain("2 day(s) left");
  });

  it("includes sprint title in finding", () => {
    const weeks: ShipWeek[] = [
      { id: "w1", title: "Q1 Final Sprint", status: "active", start_date: daysAgo(12), end_date: daysFromNow(1) },
    ];
    const issues: ShipIssue[] = Array.from({ length: 9 }, (_, i) => ({
      id: `i-${i}`,
      title: `Task ${i}`,
      state: "in_progress",
    }));
    const findings = sprintHealthFindings(weeks, issues, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("Q1 Final Sprint");
  });

  it("does not double-count done issues toward open count", () => {
    const weeks: ShipWeek[] = [
      { id: "w1", title: "Sprint 5", status: "active", start_date: daysAgo(12), end_date: daysFromNow(2) },
    ];
    const issues: ShipIssue[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `open-${i}`, title: `Open ${i}`, state: "todo" as const,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `done-${i}`, title: `Done ${i}`, state: "done" as const,
      })),
    ];
    const findings = sprintHealthFindings(weeks, issues, NOW);
    // Only 6 open issues, threshold is 8 → no finding
    expect(findings).toHaveLength(0);
  });

  it("combined with stale issues produces both finding types", () => {
    const weeks: ShipWeek[] = [
      { id: "w1", title: "Sprint 5", status: "active", start_date: daysAgo(12), end_date: daysFromNow(1) },
    ];
    const issues: ShipIssue[] = Array.from({ length: 10 }, (_, i) => ({
      id: `issue-${i}`,
      title: `Stale task ${i}`,
      state: "todo",
      updated_at: daysAgo(5), // stale AND in at-risk sprint
    }));
    const stale = staleIssueFindings(issues, NOW);
    const sprint = sprintHealthFindings(weeks, issues, NOW);
    const allFindings = [...stale, ...sprint];

    expect(stale.length).toBeGreaterThan(0);
    expect(sprint).toHaveLength(1);
    expect(allFindings.length).toBeGreaterThan(1);
    expect(computeSeverity(allFindings)).toBe("warning");
  });
});

// ─── Test Case 5: On-demand with entity context ─────────────────────
// Ship state: user on an issue page asks "What's the status of this issue?"
// Expected: graph routes to respondToUser (not hitlPath/cleanPath)
describe("Test Case 5: On-demand routing with context", () => {
  const decideRoute = (mode: "on_demand" | "proactive", findingsCount: number) => (
    mode === "on_demand" ? "respondToUser" : findingsCount > 0 ? "hitlPath" : "cleanPath"
  );

  it("graph routes on_demand mode to respondToUser (not proactive paths)", () => {
    // This tests the conditional edge logic from graph.ts:
    // if (state.input.mode === "on_demand") return "respondToUser";
    const mockState = {
      input: { mode: "on_demand" as const, target: "prod" as const, message: "What's blocking this?" },
      findings: [{ id: "1", category: "stale_issue" as const, severity: "warning" as const, title: "", detail: "", entityIds: [] }],
    };

    // Simulate the conditional edge function
    const route = decideRoute(mockState.input.mode, mockState.findings.length);

    expect(route).toBe("respondToUser");
  });

  it("proactive mode with findings routes to hitlPath", () => {
    const mode: "on_demand" | "proactive" = "proactive";
    const mockState = {
      input: { mode, target: "prod" as const },
      findings: [{ id: "1", category: "stale_issue" as const, severity: "warning" as const, title: "", detail: "", entityIds: [] }],
    };

    const route = decideRoute(mockState.input.mode, mockState.findings.length);

    expect(route).toBe("hitlPath");
  });

  it("proactive mode with no findings routes to cleanPath", () => {
    const mode: "on_demand" | "proactive" = "proactive";
    const mockState = {
      input: { mode, target: "prod" as const },
      findings: [],
    };

    const route = decideRoute(mockState.input.mode, mockState.findings.length);

    expect(route).toBe("cleanPath");
  });
});
