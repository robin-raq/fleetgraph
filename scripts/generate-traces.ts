/**
 * Generate LangSmith traces for FLEETGRAPH.md test cases.
 * Produces 4 distinct traces showing all 4 graph execution paths:
 *   1. Proactive → hitl_path (findings detected, HITL approval created)
 *   2. Proactive → clean_path (data unchanged, LLM skipped)
 *   3. On-demand → on_demand_path (user question with page context)
 *   4. On-demand → on_demand_path (different context, different question)
 *
 * Run with: npx tsx scripts/generate-traces.ts
 */
import { runFleetGraph } from "../src/graph";
import type { FleetRequestInput } from "../src/types";

interface TraceRun {
  name: string;
  description: string;
  input: FleetRequestInput;
}

const runs: TraceRun[] = [
  {
    name: "Trace 1: Proactive scan → hitl_path",
    description: "First proactive scan against prod. All 8 detectors run. Findings trigger reasoning node + HITL approval.",
    input: { mode: "proactive", target: "prod" },
  },
  {
    name: "Trace 2: Proactive scan → clean_path (diff skip)",
    description: "Second proactive scan — data unchanged since Trace 1. Graph skips LLM, routes to clean_path.",
    input: { mode: "proactive", target: "prod" },
  },
  {
    name: "Trace 3: On-demand chat → on_demand_path (dashboard context)",
    description: "User asks 'What should I focus on today?' from dashboard. Context node resolves dashboard view.",
    input: {
      mode: "on_demand",
      target: "prod",
      message: "What should I focus on today?",
      context: { pathname: "/dashboard", entityType: "unknown" },
    },
  },
  {
    name: "Trace 4: On-demand chat → on_demand_path (team context)",
    description: "User asks 'Who is overloaded this week?' from team view. Context scoped to team.",
    input: {
      mode: "on_demand",
      target: "prod",
      message: "Who is overloaded this week and what should we do about it?",
      context: { pathname: "/team/allocation", entityType: "unknown" },
    },
  },
];

async function main() {
  console.log("Generating LangSmith traces for FleetGraph-MVP...\n");

  for (const run of runs) {
    console.log(`=== ${run.name} ===`);
    console.log(`    ${run.description}\n`);

    try {
      const result = await runFleetGraph(run.input);

      console.log(`  Trace path:     ${result.tracePath}`);
      console.log(`  Severity:       ${result.severity}`);
      console.log(`  Findings:       ${result.findings.length}`);
      console.log(`  Needs approval: ${result.needsApproval}`);
      if (result.approvalId) console.log(`  Approval ID:    ${result.approvalId}`);

      if (result.findings.length > 0) {
        const byCategory = new Map<string, number>();
        for (const f of result.findings) {
          byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
        }
        console.log("  Findings by detector:");
        for (const [cat, count] of byCategory) {
          console.log(`    ${cat}: ${count}`);
        }
      }

      if (result.chatResponse) {
        console.log(`  Response:       ${result.chatResponse.slice(0, 200)}...`);
      } else if (result.summary) {
        console.log(`  Summary:        ${result.summary.slice(0, 200)}...`);
      }

      // Debug info
      if (result._debug) {
        console.log(`  Data: ${result._debug.issueCount} issues, ${result._debug.weekCount} weeks, ${result._debug.standupCount} standups, ${result._debug.teamMemberCount} team`);
        console.log(`  Data changed: ${result._debug.dataChanged}`);
      }
    } catch (error) {
      console.error(`  ERROR: ${error instanceof Error ? error.message : error}`);
    }

    console.log();
  }

  console.log("=== Done ===");
  console.log("Check LangSmith: https://smith.langchain.com → Project: FleetGraph-MVP");
  console.log("Share each trace via the 'Share' button → copy public link → paste into FLEETGRAPH.md");
}

main().catch(console.error);
