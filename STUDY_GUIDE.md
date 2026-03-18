# FleetGraph — Study Guide

## What We're Building

FleetGraph is a **project intelligence agent** for Ship (a project management platform). Ship shows you what's happening — FleetGraph tells you what's *wrong*.

- **Problem it solves:** Project teams drift. Issues go stale, sprints slip, blockers sit unresolved. Nobody checks the dashboard until it's too late.
- **Who it's for:** PMs, engineering leads, and directors who manage projects in Ship.
- **What makes it an "agent":** It doesn't just fetch data — it *reasons* about it, detects problems, and decides when to alert humans vs. stay quiet.

## How It Works (High Level)

1. **Trigger** — Either a cron job fires (proactive mode) or a user types a question in the chat (on-demand mode)
2. **Fetch** — The agent calls Ship's REST API to pull issues and sprints (`Promise.all` for parallel fetching)
3. **Analyze** — Rule-based detectors check for stale issues (no activity 3+ days) and sprint health risks (too many open issues near deadline)
4. **Route** — A conditional edge decides the next step based on mode + findings:
   - Proactive + findings → `hitlPath` (create approval, wait for human)
   - Proactive + clean → `cleanPath` (generate "all clear" summary)
   - On-demand → `respondToUser` (LLM answers the user's question with fetched data)
5. **Output** — Returns a JSON response with summary, severity, findings, and (if on-demand) a chat answer

## Key Decisions & Why

### LangGraph over plain LangChain
- **Chosen:** LangGraph (TypeScript) for the graph framework
- **Alternatives:** LangChain (too simple — no conditional branching), CrewAI (Python-only, multi-agent overkill), custom (too much reinvention)
- **Why:** The PRD requires the graph to produce *visibly different execution paths* depending on what it finds. LangGraph gives us `addConditionalEdges` natively. Think of it like a flowchart where the arrows can go different directions based on conditions.
- **Tradeoff:** LangGraph TS is less mature than Python version. Auto-tracing required explicit `LangChainTracer` callback setup.

### Polling over Webhooks
- **Chosen:** Cron-based polling every 30 minutes during business hours
- **Alternatives:** Webhooks (real-time but Ship doesn't support them), Hybrid (needs Ship changes)
- **Why:** Ship has no webhook system. Polling is the only option without modifying Ship's codebase. Like checking your mailbox every 30 minutes vs. having a doorbell — we don't have a doorbell.
- **Tradeoff:** Up to 30 min detection latency. Redundant API calls when nothing changed.

### OpenAI GPT-4o-mini over Claude/GPT-4o
- **Chosen:** GPT-4o-mini for all LLM reasoning
- **Alternatives:** Claude (PRD suggests it), GPT-4o (more capable but 10x cost)
- **Why:** Cost efficiency — $0.001 per graph run vs. ~$0.01 with GPT-4o. The reasoning tasks (summarize findings, answer questions about structured data) don't need frontier-model capability.
- **Tradeoff:** PRD constraint says Claude API — this is a known deviation.

### Detection logic as pure functions (not LLM calls)
- **Chosen:** Rule-based `staleIssueFindings()` and `sprintHealthFindings()` functions
- **Alternatives:** Have the LLM analyze raw data and detect problems
- **Why:** Deterministic, testable, fast, free. The LLM is used for *summarization and conversation*, not detection. Like using a thermometer (precise) instead of asking someone "does this feel warm?" (subjective).
- **Tradeoff:** Can't detect subtle patterns a human or LLM might catch. Rules are brittle if data shapes change.

## How Each Piece Works

### `detectors.ts` — Rule-based problem detection
- **What:** Pure functions that take Ship data and return findings
- **How:** `staleIssueFindings` filters issues where `updated_at` is 3+ days ago and state isn't "done". `sprintHealthFindings` checks if the active sprint has 8+ open issues with < 3 days remaining. Both are deterministic — same input always gives same output.
- **Example:** Input: 10 issues, 3 updated yesterday, 7 not updated in 5 days → Output: 7 findings with severity "warning"

### `graph.ts` — LangGraph state machine
- **What:** The core agent graph with 5 nodes and conditional routing
- **How:** Uses `StateGraph` from LangGraph. State carries `input`, `issues`, `weeks`, `findings`, `severity`, `tracePath`. The `addConditionalEdges` after `analyze` routes to one of three terminal nodes based on mode and findings count.
- **Example:** Input: `{mode: "proactive", target: "prod"}` → fetch → analyze (8 stale issues found) → hitlPath → Output: `{tracePath: "hitl_path", needsApproval: true, approvalId: "uuid"}`

### `shipClient.ts` — Ship REST API client
- **What:** HTTP client that fetches issues and weeks from Ship
- **How:** Sends `GET` requests with `Authorization: Bearer <token>` header. Handles flexible field naming (e.g., `updated_at` or `updatedAt`) since Ship's API shape can vary. Returns typed arrays.
- **Example:** `client.fetchIssues()` → `GET /api/issues` → returns `ShipIssue[]`

### `approvalStore.ts` — Human-in-the-loop gate
- **What:** In-memory store for approval records that block downstream actions
- **How:** When the graph detects problems, `hitlPath` creates a pending approval. The API exposes `GET /api/approvals` and `POST /api/approvals/:id` for humans to approve/reject. No notification is sent until approved.
- **Example:** Agent finds stale issues → creates approval `{status: "pending"}` → PM reviews and clicks "approved" → notification could be sent (not implemented in MVP)

### `server.ts` — Express API server
- **What:** HTTP server exposing health, chat, proactive, and approval endpoints
- **How:** Uses Zod for request validation. Routes `POST /api/chat` to on-demand mode and `POST /api/proactive/run` to proactive mode. Optional cron job for scheduled proactive runs.
- **Example:** `POST /api/chat {target: "prod", message: "What should I focus on?"}` → runs graph in on_demand mode → returns chat response

## Things That Don't Work Well

- **No persistent state between runs** — Approval records live in memory and are lost on restart. Production would need a database.
- **Stale detection is simplistic** — Only checks `updated_at` timestamp. Doesn't know if someone commented, changed labels, or had a Slack discussion about the issue.
- **On-demand chat has no memory** — Each message is independent. No conversation history between requests.
- **LangGraph TS auto-tracing doesn't work** — Had to wire `LangChainTracer` callback explicitly. The Python SDK auto-traces from env vars; the TS SDK does not.
- **Sprint health threshold is hardcoded** — 8+ open issues with < 3 days is arbitrary. Different teams have different velocities.
- **No error/fallback node** — If Ship API is down, the graph throws instead of degrading gracefully.

## Key Metrics & Results

- **Detection:** 8 stale issues correctly identified from real Ship production data
- **Trace paths:** 2 distinct paths verified in LangSmith (hitl_path, on_demand_path)
- **Test coverage:** 26 unit tests passing (detectors + approval store)
- **Response time:** ~2-4 seconds per graph run (includes Ship API fetch + OpenAI call)
- **Cost per run:** ~$0.001 (GPT-4o-mini, ~1.5K tokens)
- **Deployment:** Railway, publicly accessible at `https://fleetgraph-production-89ba.up.railway.app`
