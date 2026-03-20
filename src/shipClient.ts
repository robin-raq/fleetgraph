import type { ShipIssue, ShipStandup, ShipTarget, ShipWeek } from "./types";
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
    const payload = await this.get<unknown>("/api/issues");
    return mapRows<ShipIssue>(payload, "issues", (row) => ({
      id: pickString(row, ["id"]) ?? "",
      title: pickString(row, ["title", "name"]) ?? "Untitled issue",
      state: pickString(row, ["state", "status"]),
      priority: pickString(row, ["priority"]) ?? null,
      assignee_id: pickString(row, ["assignee_id", "assigneeId"]) ?? null,
      assignee_name: pickString(row, ["assignee_name", "assigneeName"]) ?? null,
      updated_at: pickString(row, ["updated_at", "updatedAt", "last_activity_at", "lastActivityAt"]),
      created_at: pickString(row, ["created_at", "createdAt"])
    }), (issue) => !!issue.id);
  }

  async fetchWeeks(): Promise<ShipWeek[]> {
    const payload = await this.get<unknown>("/api/weeks");
    return mapRows<ShipWeek>(payload, "weeks", (row) => ({
      id: pickString(row, ["id"]) ?? "",
      title: pickString(row, ["title", "name"]),
      start_date: pickString(row, ["start_date", "startDate"]),
      end_date: pickString(row, ["end_date", "endDate"]),
      status: pickString(row, ["status", "state"])
    }), (week) => !!week.id);
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
        id: pickString(row, ["id"]) ?? "",
        name: pickString(row, ["name", "display_name", "displayName"]) ?? "Unknown"
      }), (m) => !!m.id);
    } catch (error) {
      console.warn("[ShipClient] fetchTeamMembers failed, returning []:", error instanceof Error ? error.message : error);
      return [];
    }
  }
}

