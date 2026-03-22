# FleetGraph

A Project Intelligence Agent for [Ship](https://ship-app-production.up.railway.app) — monitors project health proactively, answers questions on demand, and always waits for human approval before acting.

**Live:** https://fleetgraph-production-89ba.up.railway.app/test.html
**Traces:** [Proactive hitl_path (19 findings)](https://smith.langchain.com/public/bd9f2eca-21f8-4747-9ff4-e5d9d0b3ef37/r) · [On-demand focus](https://smith.langchain.com/public/20f2a2b9-d36f-411e-9986-d7b5c978ba41/r) · [Diff-based skip](https://smith.langchain.com/public/9e3cee7f-bc09-4889-89f7-0184bc025dc1/r)

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
npm test           # full suite (detectors, graph, server, etc.)
npm run test:watch # watch mode
```

See **[VERIFICATION.md](./VERIFICATION.md)** for how reviewers verify detectors, graph paths, and LangSmith traces. API responses include a **`verification`** field (`context`, `graphSteps`, `langSmithHint`) plus **`findings[].detectionRule`** and **`recommendation`** on each finding.

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
| [VERIFICATION.md](./VERIFICATION.md) | Detector matrix, test file mapping, LangSmith verification, API fields for reviewers |
| [PRESEARCH.md](./PRESEARCH.md) | Pre-search checklist — design decisions made before writing code |

## License

MIT
