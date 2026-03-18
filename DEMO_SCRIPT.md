# FleetGraph Demo Script — 5 Minutes

## Setup Before Recording
- Open browser tab 1: FleetGraph test harness (`https://fleetgraph-production-89ba.up.railway.app`)
- Open browser tab 2: LangSmith project (`FleetGraph-MVP`)
- Open browser tab 3: Ship production (`https://ship-app-production.up.railway.app`) — logged in
- Clear any previous approvals by restarting the Railway service (or just note they'll stack)

---

## [0:00–0:30] Intro — The Problem

**Say:**
> "Ship shows you what's happening in your project. It doesn't tell you what's wrong."
>
> "Issues go stale, sprints slip, blockers sit unresolved — and nobody notices until it's too late. The solution isn't a better dashboard. It's an agent that watches the system and does something about it."
>
> "This is FleetGraph — a project intelligence agent for Ship."

**Show:** Briefly flash the Ship dashboard so viewers see the project management tool.

---

## [0:30–1:30] Proactive Mode — Agent Detects Problems

**Say:**
> "FleetGraph runs in two modes. First: proactive mode. The agent polls Ship every 30 minutes, analyzes the project state, and surfaces problems without anyone asking."

**Do:**
1. Switch to the FleetGraph test harness
2. Click **"Run Proactive Scan"**
3. Wait for results (~3 seconds)

**Say (while results load):**
> "The graph fetches all issues and sprints from Ship's REST API, runs rule-based detection for stale issues and sprint health risks, then sends findings to an LLM for summarization."

**Say (when results appear):**
> "It found 8 stale issues — real issues from our Ship instance that have had no activity for over 3 days. Notice the trace path says 'hitl_path' — the graph routed to the human-in-the-loop branch because it detected problems."
>
> "If there were no problems, it would have taken the 'clean_path' instead. Same graph, different execution path — that's what makes it a graph agent, not a pipeline."

---

## [1:30–2:30] Human-in-the-Loop — Agent Waits for Approval

**Say:**
> "FleetGraph never acts on its own for anything consequential. When it detects problems, it creates an approval record and waits for a human to decide."

**Do:**
1. Click **"Refresh Approvals"** in the bottom panel
2. Point out the pending approval with findings listed
3. Click **"✓ Approve"** on the approval

**Say:**
> "Here's the approval queue. The agent found 8 stale issues and is asking: should I notify the team about these? I can approve or reject."
>
> "In a production integration, approving would trigger a Slack message or an in-app notification. For MVP, we're demonstrating the gate itself — the agent proposes, the human disposes."

---

## [2:30–3:30] On-Demand Mode — User Asks Questions

**Say:**
> "Second mode: on-demand. A user opens the chat from within Ship and asks a question. The agent knows what they're looking at and answers using real project data."

**Do:**
1. Type in the chat box: **"What should I focus on today?"**
2. Click **"Send"**
3. Wait for response

**Say (when response appears):**
> "The agent fetched the same project data, but this time it routed to the 'on_demand_path' — a different branch in the graph. Instead of creating an approval, it answered my question directly."
>
> "Notice it cites specific issue titles and assignee names. It's not hallucinating — every claim is grounded in data it just pulled from Ship's API."

**Do (optional — if time allows):**
1. Change the message to: **"Who's overloaded this week?"**
2. Send again to show it handles different questions

---

## [3:30–4:15] LangSmith Traces — Observability

**Say:**
> "Every graph run is traced in LangSmith. Let me show you the two different execution paths."

**Do:**
1. Switch to the LangSmith tab
2. Click on a **proactive** trace
3. Show the node execution: `fetch → analyze → hitlPath`

**Say:**
> "Here's the proactive run. You can see fetch pulled data from Ship, analyze detected findings, and the conditional edge routed to hitlPath because findings were greater than zero."

**Do:**
1. Go back and click on an **on-demand** trace
2. Show the different path: `fetch → analyze → respondToUser`

**Say:**
> "And here's the on-demand run. Same fetch, same analyze, but the conditional edge went to respondToUser instead. Two visibly different execution paths through the same graph architecture."

---

## [4:15–4:45] Architecture — 30-Second Overview

**Say:**
> "Quick architecture overview:"
>
> "The graph has 5 nodes — a fetch node that calls Ship's REST API in parallel, an analyze node with rule-based detection, and three terminal nodes: clean path, HITL path, and on-demand response."
>
> "Conditional edges after analyze route based on two things: the mode — proactive or on-demand — and whether findings exist."
>
> "The trigger model is polling — every 30 minutes during business hours. Ship doesn't have webhooks, so polling is the only option without modifying Ship's codebase."
>
> "LLM reasoning uses GPT-4o-mini at about a tenth of a cent per run."

---

## [4:45–5:00] Wrap-Up

**Say:**
> "To summarize: FleetGraph is a graph agent that monitors Ship projects proactively, answers questions on demand, and always waits for human approval before taking action."
>
> "It's deployed on Railway, traced in LangSmith, and running against real project data — no mocks."
>
> "26 unit tests passing, two distinct trace paths verified, and the full test harness you just saw is live at the deployed URL."

---

## Key Points to Hit

If the grader is watching for MVP checklist items, make sure you mention:

- [x] "Running against real Ship data" (say it when showing issues)
- [x] "Two different execution paths" (show both traces)
- [x] "Human-in-the-loop gate" (demo the approval flow)
- [x] "Deployed and publicly accessible" (mention the Railway URL)
- [x] "LangSmith tracing from day one" (show the traces)
- [x] "Polling trigger model" (explain the 30-min cron)
