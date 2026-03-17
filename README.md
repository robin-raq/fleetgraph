# FleetGraph

FleetGraph is an external agent service for Ship that runs proactive project-health checks and supports context-aware on-demand chat from inside the Ship UI.

## MVP Features

- Proactive stale-issue detection
- Proactive sprint-health detection
- Conditional graph pathing (`clean_path` vs `hitl_path`)
- Human-in-the-loop gate for findings before team notification
- Dual Ship targets (`local` and `prod`)

## Quick Start

1. Copy env file:

```bash
cp .env.example .env
```

2. Fill in:
- `SHIP_API_TOKEN_LOCAL`
- `SHIP_API_TOKEN_PROD`
- `OPENAI_API_KEY` (optional; deterministic summaries still work without it)
- `FLEETGRAPH_API_KEY` (recommended)

3. Run:

```bash
npm install
npm run dev
```

Service runs on `http://localhost:8787` by default.

## API

- `GET /health`
- `POST /api/chat`
- `POST /api/proactive/run`
- `GET /api/approvals`
- `POST /api/approvals/:id`

