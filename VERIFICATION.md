# FleetGraph — Reviewer verification guide

This document maps **each detector** to its **rule**, **unit test**, **expected shape of outcome**, and how to **verify the full graph** (LangSmith + API).

## API: what to look for in every response

| Field | Meaning |
|-------|---------|
| `tracePath` | `clean_path` \| `hitl_path` \| `on_demand_path` \| `error_path` — which terminal branch ran |
| `findings[].category` | Which detector produced the finding |
| `findings[].detail` | Evidence string (human-readable) |
| `findings[].recommendation` | Proposed next action (PM-facing) |
| `findings[].detectionRule` | One-line **why this detector fired** (deterministic rule) |
| `verification.context` | **Echo of request context** — for on-demand, confirms `pathname`, `entityType`, `entityId`, and `viewDescription` injected into the LLM |
| `verification.graphSteps` | Ordered LangGraph node names for this run (e.g. `context` → `fetch` → `analyze` → `reason` → `respondToUser`) |
| `verification.langSmithHint` | How to find this run in LangSmith (project **FleetGraph-MVP**) |

**Example:** `POST /api/chat` with `context: { "entityType": "sprint", "entityId": "week-1", "pathname": "/sprints/week-1" }` — check `verification.context.viewDescription` is non-empty and `verification.graphSteps` ends with `respondToUser`.

## LangSmith

1. Open [LangSmith](https://smith.langchain.com) → project **FleetGraph-MVP**.
2. Runs are named `FleetGraph-{mode}-ctx-{entityType}-{entityId}` or `FleetGraph-{mode}-path-...` or `FleetGraph-{mode}-no-ctx`.
3. Tags include `mode:on_demand` / `mode:proactive`, `target:prod`, and `ctx:issue` (or `ctx:none`).
4. Open a run → the graph shows **nodes** (`context`, `fetch`, `analyze`, `reason`, …) matching `verification.graphSteps`.

## Detector matrix

| Detector (`category`) | Rule (see `detectionRule` on each finding) | Unit tests (file) | Expected when triggered |
|----------------------|--------------------------------------------|---------------------|-------------------------|
| `stale_issue` | Non-done issue, no activity ≥3d or missing timestamps | `detectors.test.ts` → `staleIssueFindings` | ≥1 finding with `category` `stale_issue`, severity `warning` |
| `sprint_health` | Active sprint, ≥8 open issues, ≤3 days left | `sprintHealthFindings` | One sprint-level finding, `warning` |
| `unassigned_high_priority` | High/urgent/critical, no assignee, not done | `unassignedHighPriorityFindings` | Per issue, severity `critical` |
| `missed_standup` | Roster member with no standup for active week | `missedStandupFindings` | Per person, severity `info` |
| `overdue_issue` | `due_date` in the past, not done | `overdueIssueFindings` | Severity `critical` |
| `work_distribution` | Assignee load >2× mean and ≥ mean+3 | `workDistributionFindings` | Severity `warning` |
| `scope_creep` | >2 issues in sprint not in `planned_issue_ids` | `scopeCreepFindings` | One sprint-level finding |
| `no_sprint_plan` | Active week with `has_plan === false` | `noSprintPlanFindings` | Severity `info` |

Canonical rule strings live in `src/detectors.ts` as **`DETECTOR_RULES`**.

## Graph path tests

`src/graph.test.ts` includes **`computeGraphSteps`** cases for:

- On-demand → `reason` → `respondToUser`
- Proactive + findings → `reason` → `hitlPath`
- Proactive + unchanged data → `cleanPath` (no `reason`)
- Fetch failure → `errorFallback`

## Scripts

- `npx tsx scripts/generate-traces.ts` — runs canned scenarios against **prod** (needs env); generates LangSmith traces for the matrix in `FLEETGRAPH.md`.

---

**Summary for reviewers:** For any run, read **`verification`** + **`findings[].detectionRule`** + **`findings[].recommendation`**, then open LangSmith using **`verification.langSmithHint`** to see the same path in the traced graph.
