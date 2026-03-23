import type { BelongsTo, ShipIssue, ShipStandup, ShipTarget, ShipWeek } from "./types";
import { config, resolveShipTarget } from "./config";

export interface ShipTeamMember {
  id: string;
  name: string;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function toRows(payload: unknown, preferredKey: string): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const preferred = record[preferredKey];
  if (Array.isArray(preferred)) return preferred;
  const data = record.data;
  return Array.isArray(data) ? data : [];
}

function mapRows<T>(
  payload: unknown,
  preferredKey: string,
  mapper: (row: Record<string, unknown>) => T,
  filter: (item: T) => boolean = () => true
): T[] {
  return toRows(payload, preferredKey)
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map(mapper)
    .filter(filter);
}

const clientCache = new Map<ShipTarget, ShipClient>();

export class ShipClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(target: ShipTarget) {
    const cfg = resolveShipTarget(target);
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.token = cfg.token;
    this.timeoutMs = config.shipApiTimeoutMs;
  }

  /** Returns a cached client per target for HTTP connection reuse. */
  static for(target: ShipTarget): ShipClient {
    let client = clientCache.get(target);
    if (!client) {
      client = new ShipClient(target);
      clientCache.set(target, client);
    }
    return client;
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Ship API timeout after ${this.timeoutMs}ms on ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ship API ${response.status} on ${path}: ${text.slice(0, 200)}`);
    }

    return response.json() as Promise<T>;
  }

  async fetchIssues(): Promise<ShipIssue[]> {
    const payload = await this.get<unknown>("/api/issues?limit=500");
    return mapRows<ShipIssue>(payload, "issues", (row) => ({
      id: pickString(row, ["id"]) ?? "",
      title: pickString(row, ["title", "name"]) ?? "Untitled issue",
      state: pickString(row, ["state", "status"]),
      priority: pickString(row, ["priority"]) ?? null,
      assignee_id: pickString(row, ["assignee_id", "assigneeId"]) ?? null,
      assignee_name: pickString(row, ["assignee_name", "assigneeName"]) ?? null,
      updated_at: pickString(row, ["updated_at", "updatedAt", "last_activity_at", "lastActivityAt"]),
      created_at: pickString(row, ["created_at", "createdAt"]),
      estimate: typeof row.estimate === "number" ? row.estimate : null,
      due_date: pickString(row, ["due_date", "dueDate"]) ?? null,
      started_at: pickString(row, ["started_at", "startedAt"]) ?? null,
      completed_at: pickString(row, ["completed_at", "completedAt"]) ?? null,
      display_id: pickString(row, ["display_id", "displayId"]) ?? null,
      belongs_to: Array.isArray(row.belongs_to)
        ? (row.belongs_to as Record<string, unknown>[]).map((b) => ({
            id: String(b.id ?? ""),
            type: String(b.type ?? ""),
            title: typeof b.title === "string" ? b.title : undefined
          } satisfies BelongsTo))
        : undefined
    }), (issue) => !!issue.id);
  }

  async fetchWeeks(): Promise<ShipWeek[]> {
    const payload = await this.get<unknown>("/api/weeks");
    return mapRows<ShipWeek>(payload, "weeks", (row) => {
      // Ship API returns days_remaining but not always start_date/end_date.
      // Compute end_date from days_remaining when missing so sprint_health detector works.
      let endDate = pickString(row, ["end_date", "endDate"]);
      const daysRemaining = typeof row.days_remaining === "number" ? row.days_remaining : undefined;
      if (!endDate && daysRemaining !== undefined) {
        const end = new Date();
        end.setDate(end.getDate() + daysRemaining);
        endDate = end.toISOString().split("T")[0];
      }
      return {
        id: pickString(row, ["id"]) ?? "",
        title: pickString(row, ["title", "name"]),
        start_date: pickString(row, ["start_date", "startDate"]),
        end_date: endDate,
        status: pickString(row, ["status", "state"]),
        issue_count: typeof row.issue_count === "number" ? row.issue_count : undefined,
        completed_count: typeof row.completed_count === "number" ? row.completed_count : undefined,
        started_count: typeof row.started_count === "number" ? row.started_count : undefined,
        has_plan: typeof row.has_plan === "boolean" ? row.has_plan : undefined,
        days_remaining: daysRemaining,
        planned_issue_ids: Array.isArray(row.planned_issue_ids)
          ? (row.planned_issue_ids as unknown[]).filter((id): id is string => typeof id === "string")
          : undefined
      };
    }, (week) => !!week.id);
  }

  async fetchStandups(weekId: string): Promise<ShipStandup[]> {
    try {
      const payload = await this.get<unknown>(`/api/weeks/${weekId}/standups`);
      return mapRows<ShipStandup>(payload, "standups", (row) => ({
        id: pickString(row, ["id"]) ?? "",
        user_id: pickString(row, ["user_id", "userId"]) ?? "",
        user_name: pickString(row, ["user_name", "userName", "name"]),
        week_id: weekId,
        created_at: pickString(row, ["created_at", "createdAt"])
      }), (s) => !!(s.id && s.user_id));
    } catch (error) {
      console.warn("[ShipClient] fetchStandups failed, returning []:", error instanceof Error ? error.message : error);
      return [];
    }
  }

  async fetchTeamMembers(): Promise<ShipTeamMember[]> {
    try {
      const payload = await this.get<unknown>("/api/team/people");
      return mapRows<ShipTeamMember>(payload, "people", (row) => ({
        // Ship returns person doc ID as `id` and user ID as `user_id`.
        // Issues reference assignee by user_id, so use that for matching.
        id: pickString(row, ["user_id", "userId"]) || pickString(row, ["id"]) || "",
        name: pickString(row, ["name", "display_name", "displayName"]) ?? "Unknown"
      }), (m) => !!m.id);
    } catch (error) {
      console.warn("[ShipClient] fetchTeamMembers failed, returning []:", error instanceof Error ? error.message : error);
      return [];
    }
  }
}

