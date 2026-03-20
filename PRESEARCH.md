# PRESEARCH.md — FleetGraph Pre-Search Checklist

*Completed before writing any code. Reference document for architecture decisions.*

---

## Phase 1: Define Your Constraints

### 1. Domain Selection

**What specific use cases will you support?**

FleetGraph is a project intelligence agent for Ship (a project management platform for US Treasury). It operates in two modes:

1. **Proactive mode** — Agent monitors project state on a schedule, detects problems, and surfaces findings without being asked. Initial use cases:
   - **Stale issue detection** — Issues open for >3 days with no activity, no assignee, or stuck in a state
   - **Sprint health check** — Sprint ending soon with too many open issues, missing standups, unbalanced workload
   - **Missed standup detection** — Team members who haven't logged standups for the current sprint
   - **Blocker escalation** — High-priority or blocker issues unresolved for >24h
   - **Scope creep detection** — New issues added to a sprint mid-cycle without corresponding removals

2. **On-demand mode** — User invokes agent from within Ship's UI. Chat is context-aware (knows what page/entity the user is viewing). Use cases:
   - "What's blocking this sprint?" (from sprint view)
   - "Summarize this issue's history" (from issue view)
   - "Who's overloaded this week?" (from team view)
   - "What should I focus on today?" (from dashboard)
   - "Why is this project behind?" (from project view)

**What are the verification requirements for this domain?**

- Agent claims must be grounded in actual Ship API data, not hallucinated
- Every proactive finding must include the specific entities (issue IDs, sprint names, person names) that triggered it
- Detection latency: < 5 minutes from event appearing in Ship to agent surfacing it
- Agent must never fabricate issue states, sprint statuses, or team assignments
- Reasoning must be traceable via LangSmith for every graph run

**What data sources will you need access to?**

All data comes from the **Ship REST API** (no direct database access). Key endpoints:

| Data | Endpoint | Purpose |
|------|----------|---------|
| Issues | `GET /api/issues` | State, assignee, priority, activity |
| Sprints/Weeks | `GET /api/weeks` | Sprint status, plan, dates |
| Standups | `GET /api/weeks/:id/standups` | Who submitted, when |
| Projects | `GET /api/projects` | Project health, ICE scores |
| Team | `GET /api/team/people` | Team members, roles |
| Activity | `GET /api/activity/:type/:id` | Change history per entity |
| Dashboard | `GET /api/dashboard/my-work` | Aggregated user view |
| Context | `GET /api/claude/context` | Pre-built context for AI features |
| Issue history | `GET /api/issues/:id/history` | State transitions over time |
| Comments | `GET /api/documents/:id/comments` | Discussion threads |

Authentication: **Bearer token** via `Authorization: Bearer <token>` header. API tokens are workspace-scoped, created via `POST /api/api-tokens`.

---

### 2. Scale & Performance

**Expected query volume?**

- **Proactive mode**: 1 run per project every 5 minutes during business hours (8am-6pm). With ~5 active projects per workspace, that's ~600 proactive runs/day per workspace.
- **On-demand mode**: ~5-10 chat invocations per user per day. With ~10 active users, that's ~50-100 on-demand runs/day per workspace.
- **Total**: ~150-200 graph runs per day per workspace for MVP.

**Acceptable latency for responses?**

- **Proactive detection**: < 5 minutes from Ship state change to agent surfacing it (PRD requirement)
- **On-demand chat**: < 10 seconds for initial response, < 30 seconds for complete analysis
- **Ship API calls**: < 200ms per call (Ship API is sub-50ms on critical paths)

**Concurrent user requirements?**

- MVP: 1 workspace, ~10 concurrent users for on-demand chat
- No concurrent proactive runs needed (runs are sequential per project, one project at a time)

**Cost constraints for LLM calls?**

- OpenAI GPT-4o-mini for reasoning nodes: ~$0.15/1M input, ~$0.60/1M output
- Budget: ~$1-2/day for MVP (200 runs × ~1K tokens avg = ~200K tokens/day ≈ $0.15/day for mini)
- GPT-4o for complex reasoning if needed: ~$2.50/1M input, $10/1M output
- Strategy: Use GPT-4o-mini for most reasoning, GPT-4o only for complex multi-entity analysis

---

### 3. Reliability Requirements

**What's the cost of a wrong answer in your domain?**

- **Medium risk for proactive mode**: A false positive (flagging a healthy sprint as troubled) wastes PM attention but isn't dangerous. A false negative (missing a real blocker) means the status quo continues.
- **Low risk for on-demand mode**: User is already looking at context, so obviously wrong answers are caught immediately.
- **Key mitigation**: Never auto-modify Ship data without human approval. Agent observes and advises, it doesn't unilaterally act.

**What verification is non-negotiable?**

- Agent must cite specific entities by ID/name when making claims
- "3 issues are stale" must list which 3 issues with links
- Sprint health assessments must reference actual issue counts and states
- Never hallucinate standup content or issue history

**Human-in-the-loop requirements?**

- **Always requires human approval before**: Creating issues, reassigning work, changing sprint scope, sending notifications to team members, modifying any Ship data
- **Can act autonomously**: Fetching data, analyzing patterns, generating summaries, surfacing findings in the chat UI
- **HITL implementation**: Action nodes that propose changes show a confirmation dialog in the chat UI. User clicks approve/dismiss.

**Audit/compliance needs?**

- All graph runs traced in LangSmith (PRD requirement)
- Every proactive finding logged with timestamp, entities involved, and reasoning
- On-demand conversations stored for review
- No PII processing beyond what Ship already stores (names, emails are in Ship's data model)

---

### 4. Team & Skill Constraints

**Familiarity with agent frameworks?**

- First time building with LangGraph specifically
- Familiar with LLM APIs (OpenAI, Claude) from Ship audit work
- Experience with TypeScript/Node.js backend development

**Experience with your chosen domain?**

- Deep familiarity with Ship's codebase, API surface, and data model from 2-week audit
- Understand the entity relationships (projects → sprints → issues → standups)
- Know the pain points the PRD describes (stale issues, missed standups, scope drift)

**Comfort with eval/testing frameworks?**

- Strong testing background (745 tests in Ship, TDD workflow)
- New to LangSmith tracing and agent eval specifically
- Will use LangSmith's built-in tracing for observability

---

## Phase 2: Architecture Discovery

### 5. Agent Framework Selection

**LangChain vs LangGraph vs CrewAI vs custom?**

**Decision: LangGraph (TypeScript)**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| LangGraph | Conditional branching, parallel nodes, native LangSmith tracing, state management built-in | Learning curve | **Chosen** — PRD recommends it, meets all architecture requirements |
| LangChain | Simpler chains, familiar | No conditional branching, tracing requires manual setup | Too simple for graph requirements |
| CrewAI | Multi-agent by default | Python-only, overkill for single-agent MVP | Wrong paradigm |
| Custom | Full control | Must wire LangSmith manually, no state management | Too much reinvention |

**Single agent or multi-agent architecture?**

**Single agent** for MVP. One graph handles both proactive and on-demand modes. The trigger is different (cron vs user message), but the graph architecture is shared (context → fetch → reason → conditional → act).

Multi-agent is future scope if we need specialized agents per domain (sprint agent, issue agent, team agent).

**State management requirements?**

LangGraph's built-in `StateGraph` with `Annotation`:
- `mode`: "proactive" | "on_demand"
- `context`: Current user, current view, current entity
- `fetchedData`: Raw Ship API responses
- `analysis`: LLM reasoning output
- `severity`: "critical" | "warning" | "info" | "clean"
- `proposedActions`: Actions the agent wants to take
- `humanApproval`: Whether HITL gate was passed
- `messages`: Chat history (on-demand mode only)

**Tool integration complexity?**

Low. All tools are HTTP calls to Ship's REST API. No complex SDKs, no OAuth flows, no streaming APIs. Bearer token auth is straightforward.

---

### 6. LLM Selection

**GPT-5 vs Claude vs open source?**

**Decision: OpenAI (GPT-4o-mini primary, GPT-4o for complex reasoning)**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| GPT-4o-mini | Cheap ($0.15/$0.60 per 1M), fast, good function calling | Less capable on complex analysis | **Primary** — handles 90% of reasoning |
| GPT-4o | Strong reasoning, large context | More expensive ($2.50/$10 per 1M) | **Fallback** — complex multi-entity analysis |
| Claude | Strong analysis | PRD says Claude API but user chose OpenAI | Overridden by user preference |
| Open source | Free inference | Hosting complexity, weaker function calling | Not for MVP |

**Function calling support requirements?**

- OpenAI function calling for structured output from reasoning nodes
- Structured responses: severity levels, entity lists, action proposals
- JSON mode for consistent parsing

**Context window needs?**

- Typical input: ~2-4K tokens (project context + fetched data from ~5 API calls)
- GPT-4o-mini has 128K context — more than enough
- No need for large context windows in MVP

**Cost per query acceptable?**

- Target: < $0.01 per graph run
- GPT-4o-mini at ~2K input + ~500 output tokens = ~$0.0006 per run
- 200 runs/day = ~$0.12/day = ~$3.60/month
- Well within budget

---

### 7. Tool Design

**What tools does your agent need?**

| Tool | Action | Ship API Endpoint |
|------|--------|-------------------|
| `fetchIssues` | Get all issues with filters (state, sprint, assignee) | `GET /api/issues` |
| `fetchIssue` | Get single issue with full detail | `GET /api/issues/:id` |
| `fetchIssueHistory` | Get state transition history | `GET /api/issues/:id/history` |
| `fetchSprint` | Get sprint details and status | `GET /api/weeks/:id` |
| `fetchSprintIssues` | Get all issues in a sprint | `GET /api/weeks/:id/issues` |
| `fetchStandups` | Get standups for a sprint | `GET /api/weeks/:id/standups` |
| `fetchProject` | Get project details | `GET /api/projects/:id` |
| `fetchTeam` | Get all team members | `GET /api/team/people` |
| `fetchActivity` | Get activity log for entity | `GET /api/activity/:type/:id` |
| `fetchDashboard` | Get user's work dashboard | `GET /api/dashboard/my-work` |

**External API dependencies?**

- Ship REST API (primary data source)
- OpenAI API (reasoning)
- LangSmith API (tracing, automatic via LangGraph)

**Mock vs real data for development?**

**Real data** — PRD requirement: "Running against real Ship data — no mocked responses." We'll use the deployed Ship instance at `https://ship-app-production.up.railway.app` with a Bearer token.

**Error handling per tool?**

Each Ship API tool:
1. Returns `{ success: true, data: ... }` or `{ success: false, error: ... }`
2. Timeout: 10 seconds per call
3. On 401: Log auth error, abort graph run
4. On 404: Return empty result (entity doesn't exist)
5. On 429: Retry once after 1 second, then fail gracefully
6. On 500: Log error, continue graph with partial data (other fetches may have succeeded)

---

### 8. Observability Strategy

**LangSmith vs Braintrust vs other?**

**Decision: LangSmith**

PRD mandates LangSmith tracing from day one. LangGraph has native integration — just set two env vars:
```
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=<key>
```

Every graph run automatically produces a trace showing node execution, LLM calls, conditional branching, and state transitions.

**What metrics matter most?**

1. **Detection latency**: Time from Ship state change to agent surfacing finding
2. **Graph execution time**: End-to-end runtime per graph invocation
3. **LLM token usage**: Input/output tokens per run (cost tracking)
4. **Branching distribution**: How often does the graph take the "problem detected" vs "clean" path
5. **HITL approval rate**: How often do users approve vs dismiss proposed actions

**Real-time monitoring needs?**

- LangSmith dashboard for trace inspection
- Basic health check endpoint on the agent server
- Log proactive run results (findings count, severity) to stdout for Railway logs

**Cost tracking requirements?**

- Track tokens per run via LangSmith metadata
- Monthly cost projection based on actual usage patterns
- Alert if daily cost exceeds $5 (anomaly detection)

---

### 9. Eval Approach

**How will you measure correctness?**

- **Test cases defined by us** (PRD: "You define your own test cases")
- For each use case: define a Ship state, expected agent detection, and LangSmith trace
- Example: Create an issue with no activity for 5 days → agent should flag it as stale with severity "warning"

**Ground truth data sources?**

- Real Ship project data (issues, sprints, standups that actually exist)
- Manually verified expected outputs for each test scenario
- Ship API responses as ground truth for entity states

**Automated vs human evaluation?**

- **Automated for MVP**: Script that triggers graph runs against known Ship states and verifies the output contains expected entities/severity
- **Human for quality**: Review LangSmith traces to ensure reasoning quality
- Future: LangSmith evaluation datasets for regression testing

**CI integration for eval runs?**

- Not for MVP. Manual eval via LangSmith trace review.
- Future: GitHub Action that runs eval suite on PR and posts results.

---

### 10. Verification Design

**What claims must be verified?**

- "Issue X is stale" → Verify last activity timestamp from Ship API
- "Sprint Y is at risk" → Verify open issue count vs sprint end date
- "Person Z missed standup" → Verify standup list for that sprint/person
- All entity references must resolve to real Ship entities

**Fact-checking data sources?**

Ship REST API is the single source of truth. Agent fetches data, reasons about it, and cites it. No external fact-checking needed since we control the data source.

**Confidence thresholds?**

- Severity "critical": Agent is certain there's a problem (e.g., blocker issue unresolved >48h)
- Severity "warning": Likely problem that warrants attention (e.g., sprint 70% through with 50% of issues still open)
- Severity "info": Observation worth noting but not urgent (e.g., one standup missed)
- Severity "clean": No issues detected

**Escalation triggers?**

- Critical severity → Immediate notification (proactive mode) or prominent alert (on-demand)
- Warning severity → Included in next proactive summary
- Multiple warnings accumulating → Escalate to critical

---

## Phase 3: Post-Stack Refinement

### 11. Failure Mode Analysis

**What happens when tools fail?**

- **Ship API down**: Graph enters error/fallback node. Returns cached last-known state if available, otherwise surfaces "Unable to reach Ship — check back shortly" message.
- **Single endpoint fails**: Graph continues with partial data. Reasoning node notes which data is missing and caveats its analysis accordingly.
- **OpenAI API down**: Graph cannot reason. Return graceful error: "Analysis unavailable — try again in a moment."

**How to handle ambiguous queries?**

- On-demand mode: Ask clarifying question before fetching ("Which sprint are you asking about?")
- If context is available from current view (e.g., user is on sprint page), use that as default
- Never guess at entity IDs — use the context node to resolve them

**Rate limiting and fallback strategies?**

- Ship API: 100 req/min (production). A typical graph run uses 3-5 API calls. At 200 runs/day, we use ~600-1000 calls/day — well under limit.
- OpenAI API: Standard rate limits. Use exponential backoff with 3 retries.
- If rate limited: Queue the run and retry after 60 seconds.

**Graceful degradation approach?**

1. **Full degradation**: Both APIs down → Static error message, no analysis
2. **Partial degradation**: Ship API up, OpenAI down → Return raw data without analysis
3. **Partial data**: Some Ship endpoints fail → Analyze what we have, note gaps

---

### 12. Security Considerations

**Prompt injection prevention?**

- User chat messages are passed to reasoning nodes but not used as system prompts
- Ship API data (issue titles, descriptions, comments) could contain injection attempts
- Mitigation: Treat all Ship data as untrusted user content. Reasoning prompt clearly separates system instructions from data.
- LLM output is never executed as code

**Data leakage risks?**

- Agent only accesses data within the authenticated workspace (Bearer token is workspace-scoped)
- No cross-workspace data access possible
- Chat history stored server-side, not sent to external services beyond OpenAI
- LangSmith traces may contain Ship data — ensure LangSmith project is private

**API key management?**

- Ship Bearer token: Environment variable `SHIP_API_TOKEN`
- OpenAI API key: Environment variable `OPENAI_API_KEY`
- LangSmith API key: Environment variable `LANGCHAIN_API_KEY`
- All keys in Railway environment variables, never committed to git
- `.env.example` with placeholder values for documentation

**Audit logging requirements?**

- LangSmith traces serve as the audit log for all graph runs
- Each trace includes: timestamp, trigger (proactive/on-demand), user context, fetched data, reasoning, proposed actions, HITL outcome
- Railway logs capture server-level events

---

### 13. Testing Strategy

**Unit tests for tools?**

- Test each Ship API tool with mocked HTTP responses
- Verify correct URL construction, header injection, error handling
- Verify response parsing and normalization

**Integration tests for agent flows?**

- Test full graph execution against real Ship API (staging or production with read-only token)
- Verify conditional branching: same graph produces different paths for "stale issues found" vs "all clean"
- Verify HITL gate pauses execution correctly

**Adversarial testing approach?**

- Test with empty Ship workspace (no issues, no sprints)
- Test with issue titles containing prompt injection attempts
- Test with concurrent on-demand requests
- Test with Ship API returning unexpected shapes (missing fields)

**Regression testing setup?**

- LangSmith test datasets for each use case
- Run after each graph change to ensure existing detections still work
- Future: CI pipeline that runs regression suite

---

### 14. Open Source Planning

**What will you release?**

- FleetGraph repo will be public on GitHub (Gauntlet AI fellowship project)
- Core graph architecture, Ship API client, deployment config

**Licensing considerations?**

- MIT license (permissive, standard for fellowship projects)
- Ship itself is forked from Treasury open-source — FleetGraph is an independent project that consumes its API

**Documentation requirements?**

- FLEETGRAPH.md (PRD deliverable — agent responsibility, graph diagram, use cases, trigger model, test cases, architecture decisions, cost analysis)
- README.md with setup instructions
- PRESEARCH.md (this document)

**Community engagement plan?**

- LinkedIn post about the project (already drafted for Browsfield project)
- Demo video showing proactive detection and on-demand chat
- Open to contributions after fellowship submission

---

### 15. Deployment & Operations

**Hosting approach?**

- **Railway** — Already have account set up for Ship. Deploy FleetGraph as a separate service.
- Express server handling: on-demand chat API, proactive cron endpoint, health check
- Single container deployment with Dockerfile

**CI/CD for agent updates?**

- GitHub → Railway auto-deploy on push to main
- No staging environment for MVP (deploy directly to production)
- Rollback via Railway's deploy history

**Monitoring and alerting?**

- Railway logs for server health
- LangSmith dashboard for graph run monitoring
- Health check endpoint: `GET /health`
- Future: Slack/Discord webhook for critical proactive findings

**Rollback strategy?**

- Railway supports instant rollback to previous deploy
- Graph changes are code changes — git revert + redeploy
- No database state to migrate (FleetGraph is stateless, reads from Ship API)

---

### 16. Iteration Planning

**How will you collect user feedback?**

- Chat UI has thumbs up/down on agent responses
- LangSmith traces reviewed for reasoning quality
- Direct feedback during Gauntlet AI fellowship review

**Eval-driven improvement cycle?**

1. Add new test case for observed failure
2. Update graph logic (node/edge/prompt)
3. Run regression suite
4. Verify fix in LangSmith trace
5. Deploy

**Feature prioritization approach?**

- MVP: Stale issue detection (proactive) + context-aware chat (on-demand)
- Early submission: Sprint health, missed standups, blocker escalation
- Final: All 5+ use cases with test cases and traces

**Long-term maintenance plan?**

- FleetGraph is a fellowship project. Post-fellowship: open-source for community, or integrate into Ship as a first-party feature.
- Maintenance: Update Ship API client if endpoints change, update prompts as reasoning improves.
