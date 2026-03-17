import { Annotation, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "./config";
import { createApproval } from "./approvalStore";
import { ShipClient } from "./shipClient";
import type { Finding, FleetRequestInput, FleetResult, Severity, ShipIssue, ShipWeek } from "./types";

const FleetState = Annotation.Root({
  input: Annotation<FleetRequestInput>(),
  issues: Annotation<ShipIssue[]>(),
  weeks: Annotation<ShipWeek[]>(),
  findings: Annotation<Finding[]>(),
  severity: Annotation<Severity>(),
  summary: Annotation<string>(),
  tracePath: Annotation<"clean_path" | "hitl_path">(),
  needsApproval: Annotation<boolean>(),
  approvalId: Annotation<string | undefined>()
});

function toDate(dateLike?: string): Date | null {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  return Number.isNaN(d.getTime()) ? null : d;
}

function staleIssueFindings(issues: ShipIssue[]): Finding[] {
  const now = Date.now();
  const staleMs = 1000 * 60 * 60 * 24 * 3;

  return issues
    .filter((issue) => (issue.state ?? "").toLowerCase() !== "done")
    .filter((issue) => {
      const updated = toDate(issue.updated_at)?.getTime() ?? toDate(issue.created_at)?.getTime();
      if (!updated) return true;
      return now - updated >= staleMs;
    })
    .slice(0, 8)
    .map((issue) => ({
      id: `stale-${issue.id}`,
      category: "stale_issue",
      severity: "warning",
      title: `Stale issue: ${issue.title}`,
      detail: `Issue ${issue.id} appears inactive for 3+ days and is still not done.`,
      entityIds: [issue.id]
    }));
}

function sprintHealthFindings(weeks: ShipWeek[], issues: ShipIssue[]): Finding[] {
  const activeWeek = weeks.find((week) => (week.status ?? "").toLowerCase().includes("active"));
  if (!activeWeek) return [];

  const openIssues = issues.filter((issue) => !["done", "cancelled"].includes((issue.state ?? "").toLowerCase())).length;
  const endDate = toDate(activeWeek.end_date);
  if (!endDate) return [];

  const daysRemaining = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysRemaining > 3 || openIssues < 8) return [];

  return [
    {
      id: `sprint-health-${activeWeek.id}`,
      category: "sprint_health",
      severity: "warning",
      title: `Sprint health risk: ${activeWeek.title ?? activeWeek.id}`,
      detail: `${openIssues} issues are still open with ${Math.max(daysRemaining, 0)} day(s) left in the active sprint.`,
      entityIds: [activeWeek.id]
    }
  ];
}

function computeSeverity(findings: Finding[]): Severity {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.some((f) => f.severity === "info")) return "info";
  return "clean";
}

async function summarize(findings: Finding[], fallback: string): Promise<string> {
  if (!config.openAiApiKey || findings.length === 0) return fallback;

  const model = new ChatOpenAI({
    apiKey: config.openAiApiKey,
    model: config.openAiModel,
    temperature: 0.1
  });

  const findingList = findings.map((f) => `- ${f.title}: ${f.detail}`).join("\n");
  const response = await model.invoke([
    {
      role: "system",
      content: "You are a concise engineering assistant. Summarize findings in 2 short sentences."
    },
    {
      role: "user",
      content: `Summarize:\n${findingList}`
    }
  ]);

  const text = typeof response.content === "string" ? response.content : fallback;
  return text || fallback;
}

const graph = new StateGraph(FleetState)
  .addNode("fetch", async (state) => {
    const client = new ShipClient(state.input.target);
    const [issues, weeks] = await Promise.all([client.fetchIssues(), client.fetchWeeks()]);
    return { issues, weeks };
  })
  .addNode("analyze", (state) => {
    const findings = [
      ...staleIssueFindings(state.issues),
      ...sprintHealthFindings(state.weeks, state.issues)
    ];
    const severity = computeSeverity(findings);
    return {
      findings,
      severity,
      needsApproval: findings.length > 0
    };
  })
  .addNode("cleanPath", async () => {
    const summary = await summarize([], "No stale-issue or sprint-health risks detected right now.");
    return {
      summary,
      tracePath: "clean_path" as const,
      needsApproval: false,
      approvalId: undefined
    };
  })
  .addNode("hitlPath", async (state) => {
    const summary = await summarize(
      state.findings,
      `Detected ${state.findings.length} finding(s) that require review before notifying the team.`
    );
    const approval = createApproval(state.input.target, state.findings);
    return {
      summary,
      tracePath: "hitl_path" as const,
      needsApproval: true,
      approvalId: approval.id
    };
  })
  .addConditionalEdges("analyze", (state) => (state.findings.length > 0 ? "hitlPath" : "cleanPath"))
  .addEdge("__start__", "fetch")
  .addEdge("fetch", "analyze")
  .addEdge("cleanPath", "__end__")
  .addEdge("hitlPath", "__end__");

const compiled = graph.compile();

export async function runFleetGraph(input: FleetRequestInput): Promise<FleetResult> {
  const result = await compiled.invoke({
    input,
    issues: [],
    weeks: [],
    findings: [],
    severity: "clean",
    summary: "",
    tracePath: "clean_path",
    needsApproval: false,
    approvalId: undefined
  });

  return {
    summary: result.summary,
    severity: result.severity,
    findings: result.findings,
    needsApproval: result.needsApproval,
    approvalId: result.approvalId,
    tracePath: result.tracePath
  };
}
