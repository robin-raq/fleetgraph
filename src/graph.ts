import { Annotation, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { config } from "./config";
import { createApproval } from "./approvalStore";
import { ShipClient } from "./shipClient";
import { isActiveWeek, staleIssueFindings, sprintHealthFindings, unassignedHighPriorityFindings, missedStandupFindings, overdueIssueFindings, workDistributionFindings, scopeCreepFindings, noSprintPlanFindings, computeSeverity } from "./detectors";
import { hasDataChanged } from "./dataHash";
import { resolveContext } from "./contextResolver";
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
  tracePath: Annotation<"clean_path" | "hitl_path" | "on_demand_path" | "error_path">(),
  needsApproval: Annotation<boolean>(),
  approvalId: Annotation<string | undefined>(),
  chatResponse: Annotation<string | undefined>(),
  dataChanged: Annotation<boolean>(),
  fetchError: Annotation<boolean>(),
  errorMessage: Annotation<string>(),
  viewDescription: Annotation<string>(),
  reasoning: Annotation<string>(),
  // Debug counters — exposed in API response for diagnostics
  _issueCount: Annotation<number>(),
  _weekCount: Annotation<number>(),
  _standupCount: Annotation<number>(),
  _teamMemberCount: Annotation<number>()
});

let tracer: LangChainTracer | undefined;
let model: ChatOpenAI | undefined;

function getTracer(): LangChainTracer {
  if (!tracer) tracer = new LangChainTracer({ projectName: "FleetGraph-MVP" });
  return tracer;
}

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

  try {
    const llm = getModel();
    const findingList = findings.map((f) => {
      const rec = f.recommendation ? ` → Recommendation: ${f.recommendation}` : "";
      return `- [${f.severity}] ${f.title}: ${f.detail}${rec}`;
    }).join("\n");
    const response = await llm.invoke([
      {
        role: "system",
        content: "You are FleetGraph, a project intelligence agent. Given these findings, produce:\n1. A 2-sentence summary of the situation.\n2. A numbered list of specific recommended actions (use issue IDs, people names, and sprint names).\nEach recommendation should be a concrete action a PM could take right now — not a vague suggestion.\nIf a finding includes a recommendation, incorporate it."
      },
      {
        role: "user",
        content: `Findings:\n${findingList}`
      }
    ]);

    const text = typeof response.content === "string" ? response.content : fallback;
    return text || fallback;
  } catch (error) {
    console.error("[summarize] LLM call failed, using fallback:", error instanceof Error ? error.message : error);
    return fallback;
  }
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
  .addNode("context", (state) => {
    const resolved = resolveContext(state.input);
    return { viewDescription: resolved.viewDescription };
  })
  .addNode("fetch", async (state) => {
    try {
      const client = ShipClient.for(state.input.target);

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

      const dataChanged = state.input.mode === "on_demand"
        ? true  // always process on-demand requests
        : hasDataChanged(state.input.target, issues, weeks, standups, teamMembers);

      return { issues, weeks, standups, teamMembers, dataChanged, fetchError: false, errorMessage: "", _issueCount: issues.length, _weekCount: weeks.length, _standupCount: standups.length, _teamMemberCount: teamMembers.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown fetch error";
      console.error("[fetch] Ship API error:", message);
      return { fetchError: true, errorMessage: message, issues: [], weeks: [], standups: [], teamMembers: [] };
    }
  })
  .addNode("analyze", (state) => {
    const activeWeek = state.weeks.find(isActiveWeek);

    const findings = [
      ...staleIssueFindings(state.issues),
      ...sprintHealthFindings(state.weeks, state.issues),
      ...unassignedHighPriorityFindings(state.issues),
      ...overdueIssueFindings(state.issues),
      ...workDistributionFindings(state.issues, state.teamMembers),
      ...scopeCreepFindings(state.weeks, state.issues),
      ...noSprintPlanFindings(state.weeks),
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
  .addNode("reason", async (state) => {
    // Skip reasoning when no LLM key or no findings in proactive mode
    if (!config.openAiApiKey) return { reasoning: "" };
    if (state.input.mode === "proactive" && state.findings.length === 0) return { reasoning: "" };

    try {
      const llm = getModel();
      const dataContext = formatDataContext(state.issues, state.weeks, state.findings);

      const findingList = state.findings.length > 0
        ? state.findings.map((f) => {
            const rec = f.recommendation ? ` → Recommended: ${f.recommendation}` : "";
            return `- [${f.severity}] ${f.title}: ${f.detail}${rec}`;
          }).join("\n")
        : "No findings from rule-based detectors.";

      const isOnDemand = state.input.mode === "on_demand";
      const userQuestion = isOnDemand
        ? `\n\nThe user asks: "${state.input.message ?? "Give me a project status summary."}"\nAnswer their question while incorporating your analysis.`
        : "";

      const response = await llm.invoke([
        {
          role: "system",
          content: `You are FleetGraph, a project intelligence agent. You have access to project data and rule-based detector findings below.

Your job is to REASON about this data — not just summarize it. Specifically:
1. Identify RELATIONSHIPS between findings (e.g., "Alice is overloaded AND her issues are going stale — these are related; the root cause is capacity")
2. Assess COMPOUND RISK — multiple warnings in the same area may indicate a systemic issue
3. PRIORITIZE recommended actions — what should the PM do FIRST and why
4. Surface NON-OBVIOUS patterns the detectors may have missed (e.g., all stale issues belong to one project, or one person appears in multiple finding categories)

Be specific: use issue IDs, people names, sprint names. Keep your analysis to 3-5 sentences max.${userQuestion}

${state.viewDescription}

${dataContext}

## Rule-Based Detector Findings
${findingList}`
        },
        {
          role: "user",
          content: isOnDemand
            ? (state.input.message ?? "Give me a project status summary.")
            : "Analyze these findings. What are the relationships, root causes, and highest-priority actions?"
        }
      ]);

      const text = typeof response.content === "string" ? response.content : "";
      return { reasoning: text };
    } catch (error) {
      console.error("[reason] LLM call failed:", error instanceof Error ? error.message : error);
      return { reasoning: "" };
    }
  })
  // Synchronous — no LLM call needed when there are no findings (intentional cost saving)
  .addNode("cleanPath", () => ({
    summary: "No stale-issue or sprint-health risks detected right now.",
    tracePath: "clean_path" as const,
    needsApproval: false,
    approvalId: undefined,
    chatResponse: undefined
  }))
  .addNode("hitlPath", (state) => {
    const summary = state.reasoning || `Detected ${state.findings.length} finding(s) that require review.`;
    const approval = createApproval(state.input.target, state.findings);
    return {
      summary,
      tracePath: "hitl_path" as const,
      needsApproval: true,
      approvalId: approval.id,
      chatResponse: undefined
    };
  })
  .addNode("respondToUser", (state) => {
    // Reasoning node already called the LLM — use its output
    const chatText = state.reasoning || "I'm unable to process your request right now. Please try again later.";
    return {
      summary: chatText,
      tracePath: "on_demand_path" as const,
      needsApproval: false,
      approvalId: undefined,
      chatResponse: chatText
    };
  })
  .addNode("errorFallback", (state) => {
    const isOnDemand = state.input.mode === "on_demand";
    // Sanitize: don't leak internal error details to end users
    const safeMessage = isOnDemand
      ? "I'm unable to reach the project data source right now. Please try again in a moment."
      : "Proactive scan failed. Will retry on next scheduled run.";

    if (state.errorMessage) {
      console.error(`[errorFallback] ${state.input.mode}:`, state.errorMessage);
    }

    return {
      summary: safeMessage,
      tracePath: "error_path" as const,
      severity: "clean" as const,
      needsApproval: false,
      approvalId: undefined,
      chatResponse: isOnDemand ? safeMessage : undefined,
      issues: [],
      weeks: [],
      standups: [],
      teamMembers: []
    };
  })
  .addConditionalEdges("fetch", (state) => {
    if (state.fetchError) return "errorFallback";
    return "analyze";
  })
  .addConditionalEdges("analyze", (state) => {
    // Skip reasoning (and LLM) when proactive data is unchanged or no findings
    if (state.input.mode === "proactive" && !state.dataChanged) return "cleanPath";
    if (state.input.mode === "proactive" && state.findings.length === 0) return "cleanPath";
    // All other paths go through reasoning node first
    return "reason";
  })
  .addConditionalEdges("reason", (state) => {
    if (state.input.mode === "on_demand") return "respondToUser";
    return state.findings.length > 0 ? "hitlPath" : "cleanPath";
  })
  .addEdge("__start__", "context")
  .addEdge("context", "fetch")
  .addEdge("cleanPath", "__end__")
  .addEdge("hitlPath", "__end__")
  .addEdge("respondToUser", "__end__")
  .addEdge("errorFallback", "__end__");

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
      chatResponse: undefined,
      dataChanged: true,
      fetchError: false,
      errorMessage: "",
      viewDescription: "",
      reasoning: ""
    },
    {
      runName: `FleetGraph-${input.mode}`,
      metadata: { mode: input.mode, target: input.target },
      callbacks: [getTracer()]
    }
  );

  return {
    summary: result.summary,
    severity: result.severity,
    findings: result.findings,
    needsApproval: result.needsApproval,
    approvalId: result.approvalId,
    tracePath: result.tracePath,
    chatResponse: result.chatResponse,
    _debug: {
      issueCount: result._issueCount,
      weekCount: result._weekCount,
      standupCount: result._standupCount,
      teamMemberCount: result._teamMemberCount,
      dataChanged: result.dataChanged,
      fetchError: result.fetchError
    }
  };
}
