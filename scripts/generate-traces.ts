/**
 * Generate LangSmith traces for all 6 FLEETGRAPH.md use cases.
 * Run with: npx tsx scripts/generate-traces.ts
 */
import { runFleetGraph } from "../src/graph";
import type { FleetRequestInput } from "../src/types";

const useCases: { name: string; input: FleetRequestInput }[] = [
  {
    name: "UC1: Stale issues (proactive)",
    input: { mode: "proactive", target: "prod" }
  },
  {
    name: "UC2: Sprint health risk (proactive)",
    input: { mode: "proactive", target: "prod" }
    // Same proactive scan — sprint health detector runs alongside stale issues
  },
  {
    name: "UC3: What should I focus on today? (on-demand, dashboard)",
    input: {
      mode: "on_demand",
      target: "prod",
      message: "What should I focus on today?",
      context: { pathname: "/dashboard", entityType: "project" as const }
    }
  },
  {
    name: "UC4: Project health summary (on-demand, project view)",
    input: {
      mode: "on_demand",
      target: "prod",
      message: "Give me a project health summary — open issues, sprint progress, and any risks you see.",
      context: { pathname: "/projects", entityType: "project" as const }
    }
  },
  {
    name: "UC5: Unassigned high-priority (proactive)",
    input: { mode: "proactive", target: "prod" }
    // Same proactive scan — unassigned high-priority detector runs
  },
  {
    name: "UC6: Missed standups (proactive)",
    input: { mode: "proactive", target: "prod" }
    // Same proactive scan — missed standup detector runs
  }
];

async function main() {
  // Proactive use cases (1, 2, 5, 6) all run in the same graph — run once and reuse
  console.log("\n=== Running proactive scan (covers UC1, UC2, UC5, UC6) ===\n");
  const proactiveResult = await runFleetGraph(useCases[0].input);
  console.log("Trace path:", proactiveResult.tracePath);
  console.log("Severity:", proactiveResult.severity);
  console.log("Findings:", proactiveResult.findings.length);

  // Break down findings by category
  const byCategory = new Map<string, number>();
  for (const f of proactiveResult.findings) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  }
  console.log("\nFindings by category:");
  for (const [cat, count] of byCategory) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log("Summary:", proactiveResult.summary?.slice(0, 200));
  console.log("Needs approval:", proactiveResult.needsApproval);
  if (proactiveResult.approvalId) console.log("Approval ID:", proactiveResult.approvalId);

  // Run a second proactive to test diff-based polling (should show dataChanged: false behavior)
  console.log("\n=== Running second proactive scan (diff-based skip test) ===\n");
  const proactive2 = await runFleetGraph(useCases[0].input);
  console.log("Trace path:", proactive2.tracePath);
  console.log("Severity:", proactive2.severity);
  console.log("Findings:", proactive2.findings.length);

  // On-demand: UC3 — "What should I focus on today?"
  console.log("\n=== UC3: What should I focus on today? ===\n");
  const uc3 = await runFleetGraph(useCases[2].input);
  console.log("Trace path:", uc3.tracePath);
  console.log("Chat response:", uc3.chatResponse?.slice(0, 300));

  // On-demand: UC4 — Project health summary
  console.log("\n=== UC4: Project health summary ===\n");
  const uc4 = await runFleetGraph(useCases[3].input);
  console.log("Trace path:", uc4.tracePath);
  console.log("Chat response:", uc4.chatResponse?.slice(0, 300));

  console.log("\n=== Done — check LangSmith for traces ===");
  console.log("Project: FleetGraph-MVP");
  console.log("Total runs: 4 (1 proactive + 1 proactive repeat + 2 on-demand)");
}

main().catch(console.error);
