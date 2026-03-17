# FLEETGRAPH.md

## Agent Responsibility

FleetGraph monitors Ship project execution quality and surfaces actionable findings with evidence. It does not modify Ship data autonomously. Any action that could notify or change team workflow passes a human-approval gate.

## Use Cases (MVP + Near-Term)

1. Stale issue detection (proactive)
2. Sprint health risk detection (proactive)
3. Route-aware "what should I focus on" guidance (on-demand)
4. Context summary for current issue/project/sprint view (on-demand)
5. Approval queue for proposed notifications/escalations (HITL)

## Graph Model

```text
START
  -> fetch (Ship API: issues + weeks)
  -> analyze (stale + sprint risk checks)
  -> [if findings > 0] hitlPath -> END
     [else]           cleanPath -> END
```

- `cleanPath`: returns clean summary and no approval requirement
- `hitlPath`: returns findings, creates approval record, marks `needsApproval=true`

This guarantees at least two trace paths in LangSmith:
- `clean_path`
- `hitl_path`

## Trigger Model

- **On-demand**: `POST /api/chat` from embedded Ship panel
- **Proactive**: `POST /api/proactive/run` (manual or Railway cron)
- **Scheduled**: optional in-process cron when `ENABLE_PROACTIVE_CRON=true`

## Targeting Model

FleetGraph supports both Ship environments:
- `target=local` -> `SHIP_API_BASE_URL_LOCAL` + `SHIP_API_TOKEN_LOCAL`
- `target=prod` -> `SHIP_API_BASE_URL_PROD` + `SHIP_API_TOKEN_PROD`

## HITL Model

When findings exist, FleetGraph creates an approval record:
- `GET /api/approvals?status=pending`
- `POST /api/approvals/:id` with `decision=approved|rejected`

No downstream notification action is executed until approved.

