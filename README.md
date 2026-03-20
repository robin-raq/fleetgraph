# FleetGraph

A Project Intelligence Agent for [Ship](https://ship-app-production.up.railway.app) — monitors project health proactively, answers questions on demand, and always waits for human approval before acting.

**Live:** https://fleetgraph-production-89ba.up.railway.app
**Traces:** [Proactive (hitl_path)](https://smith.langchain.com/public/86bf7800-87b5-4638-a7ac-a7c7f3dc0df2/r) · [On-demand](https://smith.langchain.com/public/4fcd07e7-1b67-4dd5-86c5-a4193ce3e53c/r)

---

## What It Does

Ship shows you what's happening. FleetGraph tells you what's wrong.

- **Proactive mode** — polls Ship every 5 minutes, detects stale issues and sprint health risks, surfaces findings through a human-in-the-loop approval queue
- **On-demand mode** — embedded chat answers questions like "What should I focus on today?" using real project data, scoped to whatever the user is viewing
- **Same graph, different paths** — both modes run through a single LangGraph architecture with conditional edges that produce visibly different execution traces

## Architecture

```mermaid
graph TD
    START(("__start__")) --> fetch["fetch\n(Ship API: issues + weeks)"]
    fetch --> analyze["analyze\n(stale issues + sprint health)"]
    analyze -->|"proactive\nfindings > 0"| hitlPath["hitlPath\n(summarize + approval)"]
    analyze -->|"proactive\nfindings = 0"| cleanPath["cleanPath\n(all clear)"]
    analyze -->|"on_demand"| respondToUser["respondToUser\n(answer user question)"]
    hitlPath --> END(("__end__"))
    cleanPath --> END
    respondToUser --> END
```

**Stack:** LangGraph (TypeScript) · OpenAI GPT-4o-mini · LangSmith tracing · Express · Railway

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/robin-raq/fleetgraph.git
cd fleetgraph
npm install

# 2. Configure environment
cp .env.example .env
# Fill in: SHIP_API_TOKEN_PROD, OPENAI_API_KEY, LANGCHAIN_API_KEY

# 3. Run
npm run dev
```

Open http://localhost:8787 for the test harness.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SHIP_API_TOKEN_LOCAL` | Yes | Bearer token for local Ship instance |
| `SHIP_API_TOKEN_PROD` | Yes | Bearer token for Ship production |
| `OPENAI_API_KEY` | Yes | OpenAI API key for LLM reasoning |
| `LANGCHAIN_API_KEY` | Yes | LangSmith API key for tracing |
| `LANGCHAIN_PROJECT` | No | LangSmith project name (default: `FleetGraph-MVP`) |
| `FLEETGRAPH_API_KEY` | No | Optional auth key for FleetGraph API |
| `CORS_ORIGINS` | No | `*` or comma-separated frontend origin allowlist |
| `SHIP_API_TIMEOUT_MS` | No | Request timeout for Ship API calls (default: `8000`) |
| `ENABLE_PROACTIVE_CRON` | No | Set `true` to enable scheduled polling |
| `PROACTIVE_CRON` | No | Cron expression (default: `*/5 8-18 * * 1-5`) |
| `MAX_APPROVAL_RECORDS` | No | Cap for in-memory approval queue (default: `500`) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/` | Redirects to test harness |
| `POST` | `/api/chat` | On-demand chat (pass `message` + optional `context`) |
| `POST` | `/api/proactive/run` | Trigger a proactive scan |
| `GET` | `/api/approvals` | List approvals (filter with `?status=pending`) |
| `POST` | `/api/approvals/:id` | Approve or reject (`{decision: "approved"\|"rejected"}`) |

### Example: Proactive Scan

```bash
curl -X POST https://fleetgraph-production-89ba.up.railway.app/api/proactive/run \
  -H "Content-Type: application/json" \
  -d '{"target": "prod"}'
```

### Example: On-Demand Chat

```bash
curl -X POST https://fleetgraph-production-89ba.up.railway.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"target": "prod", "message": "What should I focus on today?"}'
```

## Testing

```bash
npm test          # run all 26 tests
npm run test:watch # watch mode
```

Tests cover:
- **Detectors** (20 tests) — stale issue detection, sprint health, severity computation, edge cases
- **Approval store** (6 tests) — create, list, filter, approve, reject

## Project Structure

```
src/
├── server.ts          # Express API + cron setup
├── graph.ts           # LangGraph state graph (fetch → analyze → route)
├── detectors.ts       # Pure detection functions (stale issues, sprint health)
├── shipClient.ts      # Ship REST API client
├── approvalStore.ts   # In-memory HITL approval queue
├── config.ts          # Environment validation (Zod)
├── types.ts           # TypeScript interfaces
├── detectors.test.ts  # Detector unit tests
└── approvalStore.test.ts  # Approval store tests
public/
└── test.html          # Browser test harness
```

## Key Documents

| File | Purpose |
|------|---------|
| [FLEETGRAPH.md](./FLEETGRAPH.md) | Agent responsibility, use cases, graph diagram, trigger model, test cases, architecture decisions, cost analysis |
| [PRESEARCH.md](./PRESEARCH.md) | Pre-search checklist — design decisions made before writing code |

## License

MIT
