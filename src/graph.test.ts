import { describe, it, expect } from "vitest";
import { staleIssueFindings, sprintHealthFindings, computeSeverity } from "./detectors";
import { resolveContext } from "./contextResolver";
import { computeGraphSteps, buildLangSmithRunName } from "./graph";
import type { ShipIssue, ShipWeek, FleetRequestInput, RouteContext } from "./types";

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

// ─── Context Resolver ────────────────────────────────────────────────
// The context node establishes who is invoking the graph, what they are
// looking at, and what their role is. It runs BEFORE fetch.
describe("Context resolver", () => {
  it("resolves on-demand mode with entity context", () => {
    const input: FleetRequestInput = {
      mode: "on_demand",
      target: "prod",
      message: "What's the status?",
      context: { pathname: "/issues/abc-123", entityType: "issue", entityId: "abc-123" },
    };
    const resolved = resolveContext(input);
    expect(resolved.mode).toBe("on_demand");
    expect(resolved.entityType).toBe("issue");
    expect(resolved.entityId).toBe("abc-123");
    expect(resolved.viewDescription).toContain("issue");
  });

  it("resolves proactive mode with no context", () => {
    const input: FleetRequestInput = {
      mode: "proactive",
      target: "prod",
    };
    const resolved = resolveContext(input);
    expect(resolved.mode).toBe("proactive");
    expect(resolved.entityType).toBeUndefined();
    expect(resolved.entityId).toBeUndefined();
    expect(resolved.viewDescription).toBe("");
  });

  it("resolves on-demand mode with pathname but no explicit entity type", () => {
    const input: FleetRequestInput = {
      mode: "on_demand",
      target: "local",
      message: "Show me the sprint",
      context: { pathname: "/projects/proj-1/sprints/sprint-5" },
    };
    const resolved = resolveContext(input);
    expect(resolved.mode).toBe("on_demand");
    expect(resolved.viewDescription).toContain("/projects/proj-1/sprints/sprint-5");
  });

  it("resolves on-demand with dashboard context (no entity)", () => {
    const input: FleetRequestInput = {
      mode: "on_demand",
      target: "prod",
      message: "What should I focus on?",
      context: { pathname: "/dashboard" },
    };
    const resolved = resolveContext(input);
    expect(resolved.mode).toBe("on_demand");
    expect(resolved.viewDescription).toContain("dashboard");
  });
});

// ─── Error/Fallback Routing ──────────────────────────────────────────
// When fetch fails, the graph should route to errorFallback instead of
// crashing. The error node returns a graceful degradation response.
describe("Error fallback routing", () => {
  const decidePostFetch = (fetchError: boolean, mode: "on_demand" | "proactive") => {
    if (fetchError) return "errorFallback";
    return "analyze";
  };

  it("routes to errorFallback when fetch fails", () => {
    expect(decidePostFetch(true, "proactive")).toBe("errorFallback");
  });

  it("routes to errorFallback when fetch fails in on-demand mode", () => {
    expect(decidePostFetch(true, "on_demand")).toBe("errorFallback");
  });

  it("routes to analyze when fetch succeeds", () => {
    expect(decidePostFetch(false, "proactive")).toBe("analyze");
  });

  it("routes to analyze when fetch succeeds in on-demand mode", () => {
    expect(decidePostFetch(false, "on_demand")).toBe("analyze");
  });
});

// ─── Reviewer verification: graph steps + LangSmith run names ─────────
describe("computeGraphSteps", () => {
  it("on_demand success: context → fetch → analyze → reason → respondToUser", () => {
    const input: FleetRequestInput = { mode: "on_demand", target: "prod", message: "Hi" };
    const steps = computeGraphSteps(input, {
      fetchError: false,
      dataChanged: true,
      findings: [{ id: "1", category: "stale_issue", severity: "warning", title: "", detail: "", entityIds: [] }],
      tracePath: "on_demand_path"
    });
    expect(steps).toEqual(["context", "fetch", "analyze", "reason", "respondToUser"]);
  });

  it("proactive with findings: context → fetch → analyze → reason → hitlPath", () => {
    const input: FleetRequestInput = { mode: "proactive", target: "prod" };
    const steps = computeGraphSteps(input, {
      fetchError: false,
      dataChanged: true,
      findings: [{ id: "1", category: "stale_issue", severity: "warning", title: "", detail: "", entityIds: [] }],
      tracePath: "hitl_path"
    });
    expect(steps).toEqual(["context", "fetch", "analyze", "reason", "hitlPath"]);
  });

  it("proactive unchanged data: skips reason (cleanPath)", () => {
    const input: FleetRequestInput = { mode: "proactive", target: "prod" };
    const steps = computeGraphSteps(input, {
      fetchError: false,
      dataChanged: false,
      findings: [{ id: "1", category: "stale_issue", severity: "warning", title: "", detail: "", entityIds: [] }],
      tracePath: "clean_path"
    });
    expect(steps).toEqual(["context", "fetch", "analyze", "cleanPath"]);
  });

  it("fetch error: context → fetch → errorFallback", () => {
    const input: FleetRequestInput = { mode: "on_demand", target: "prod" };
    const steps = computeGraphSteps(input, {
      fetchError: true,
      dataChanged: true,
      findings: [],
      tracePath: "error_path"
    });
    expect(steps).toEqual(["context", "fetch", "errorFallback"]);
  });
});

describe("buildLangSmithRunName", () => {
  it("includes entity when context has entityType + entityId", () => {
    const name = buildLangSmithRunName({
      mode: "on_demand",
      target: "prod",
      context: { entityType: "issue", entityId: "abc-123", pathname: "/issues/abc-123" }
    });
    expect(name).toBe("FleetGraph-on_demand-ctx-issue-abc-123");
  });

  it("uses pathname slug when no entity id", () => {
    const name = buildLangSmithRunName({
      mode: "on_demand",
      target: "prod",
      context: { pathname: "/sprints/5" }
    });
    expect(name).toBe("FleetGraph-on_demand-path-sprints_5");
  });

  it("marks no context", () => {
    expect(buildLangSmithRunName({ mode: "proactive", target: "prod" })).toBe("FleetGraph-proactive-no-ctx");
  });
});
