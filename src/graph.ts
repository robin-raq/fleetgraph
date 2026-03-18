import { Annotation, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { config } from "./config";
import { createApproval } from "./approvalStore";
import { ShipClient } from "./shipClient";
import { isActiveWeek, staleIssueFindings, sprintHealthFindings, unassignedHighPriorityFindings, missedStandupFindings, computeSeverity } from "./detectors";
import type { ShipTeamMember } from "./shipClient";
import type { Finding, FleetRequestInput, FleetResult, Severity, ShipIssue, ShipStandup, ShipWeek } from "./types";

const FleetState = Annotation.Root({
  input: Annotation<FleetRequestInput>(),
  issues: Annotation<ShipIssue[]>(),
  weeks: Annotation<ShipWeek[]>(),
  standups: Annotation<ShipStandup[]>(),
  teamMembers: Annotation<ShipTeamMember[]>(),
  findings: Annotation<Finding[]>(),
  severity: Annotation<Severity>(),
  summary: Annotation<string>(),
  tracePath: Annotation<"clean_path" | "hitl_path" | "on_demand_path">(),
  needsApproval: Annotation<boolean>(),
  approvalId: Annotation<string | undefined>(),
  chatResponse: Annotation<string | undefined>()
});

const tracer = new LangChainTracer({ projectName: "FleetGraph-MVP" });
let model: ChatOpenAI | undefined;

function getModel(): ChatOpenAI {
  if (!model) {
    model = new ChatOpenAI({
      apiKey: config.openAiApiKey,
      model: config.openAiModel,
      temperature: 0.1
    });
  }
  return model;
}

async function summarize(findings: Finding[], fallback: string): Promise<string> {
  if (!config.openAiApiKey || findings.length === 0) return fallback;

  const model = getModel();
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

function formatDataContext(issues: ShipIssue[], weeks: ShipWeek[], findings: Finding[]): string {
  const issuesSummary = issues.slice(0, 15).map((i) =>
    `- [${i.state ?? "unknown"}] "${i.title}" (${i.assignee_name ?? "unassigned"}, updated ${i.updated_at ?? "never"})`
  ).join("\n");

  const weeksSummary = weeks.map((w) =>
    `- "${w.title ?? w.id}" status=${w.status ?? "unknown"} (${w.start_date} to ${w.end_date})`
  ).join("\n");

  const findingsSummary = findings.length > 0
    ? findings.map((f) => `- [${f.severity}] ${f.title}: ${f.detail}`).join("\n")
    : "No issues detected.";

  return `## Current Issues (top 15)\n${issuesSummary}\n\n## Sprints\n${weeksSummary}\n\n## Detected Findings\n${findingsSummary}`;
}

const graph = new StateGraph(FleetState)
  .addNode("fetch", async (state) => {
    const client = new ShipClient(state.input.target);

    // Fan out: weeks resolves first so standups can start while issues/team are still in flight
    const weeksPromise = client.fetchWeeks();
    const standupsPromise = weeksPromise.then((weeks) => {
      const activeWeek = weeks.find(isActiveWeek);
      return activeWeek ? client.fetchStandups(activeWeek.id) : [];
    });

    const [issues, weeks, teamMembers, standups] = await Promise.all([
      client.fetchIssues(),
      weeksPromise,
      client.fetchTeamMembers(),
      standupsPromise
    ]);

    return { issues, weeks, standups, teamMembers };
  })
  .addNode("analyze", (state) => {
    const activeWeek = state.weeks.find(isActiveWeek);

    const findings = [
      ...staleIssueFindings(state.issues),
      ...sprintHealthFindings(state.weeks, state.issues),
      ...unassignedHighPriorityFindings(state.issues),
      ...(activeWeek
        ? missedStandupFindings(activeWeek, state.standups, state.teamMembers)
        : [])
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
      approvalId: undefined,
      chatResponse: undefined
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
      approvalId: approval.id,
      chatResponse: undefined
    };
  })
  .addNode("respondToUser", async (state) => {
    if (!config.openAiApiKey) {
      return {
        summary: "LLM unavailable — cannot answer right now.",
        tracePath: "on_demand_path" as const,
        needsApproval: false,
        approvalId: undefined,
        chatResponse: "I'm unable to process your request right now. Please try again later."
      };
    }

    const model = getModel();
    const dataContext = formatDataContext(state.issues, state.weeks, state.findings);
    const userMessage = state.input.message ?? "Give me a project status summary.";
    const viewContext = state.input.context
      ? `The user is currently viewing: ${state.input.context.entityType ?? "unknown"} (path: ${state.input.context.pathname ?? "/"})`
      : "";

    const response = await model.invoke([
      {
        role: "system",
        content: `You are FleetGraph, a project intelligence assistant for Ship. Answer the user's question using ONLY the project data provided below. Be specific — cite issue titles, sprint names, and people by name. Keep answers concise (3-5 sentences max). If you detect problems, mention them proactively.\n\n${viewContext}\n\n${dataContext}`
      },
      {
        role: "user",
        content: userMessage
      }
    ]);

    const chatText = typeof response.content === "string" ? response.content : "Unable to generate a response.";

    return {
      summary: chatText,
      tracePath: "on_demand_path" as const,
      needsApproval: false,
      approvalId: undefined,
      chatResponse: chatText
    };
  })
  .addConditionalEdges("analyze", (state) => {
    if (state.input.mode === "on_demand") return "respondToUser";
    return state.findings.length > 0 ? "hitlPath" : "cleanPath";
  })
  .addEdge("__start__", "fetch")
  .addEdge("fetch", "analyze")
  .addEdge("cleanPath", "__end__")
  .addEdge("hitlPath", "__end__")
  .addEdge("respondToUser", "__end__");

const compiled = graph.compile();

export async function runFleetGraph(input: FleetRequestInput): Promise<FleetResult> {
  const result = await compiled.invoke(
    {
      input,
      issues: [],
      weeks: [],
      standups: [],
      teamMembers: [],
      findings: [],
      severity: "clean",
      summary: "",
      tracePath: "clean_path",
      needsApproval: false,
      approvalId: undefined,
      chatResponse: undefined
    },
    {
      runName: `FleetGraph-${input.mode}`,
      metadata: { mode: input.mode, target: input.target },
      callbacks: [tracer]
    }
  );

  return {
    summary: result.summary,
    severity: result.severity,
    findings: result.findings,
    needsApproval: result.needsApproval,
    approvalId: result.approvalId,
    tracePath: result.tracePath,
    chatResponse: result.chatResponse
  };
}
