import type { ShipIssue, ShipTarget, ShipWeek } from "./types";
import { resolveShipTarget } from "./config";

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export class ShipClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(target: ShipTarget) {
    const cfg = resolveShipTarget(target);
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.token = cfg.token;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ship API ${response.status} on ${path}: ${text.slice(0, 200)}`);
    }

    return response.json() as Promise<T>;
  }

  async fetchIssues(): Promise<ShipIssue[]> {
    const payload = await this.get<unknown>("/api/issues");
    const rows = Array.isArray(payload)
      ? payload
      : (payload as { issues?: unknown[]; data?: unknown[] })?.issues ??
        (payload as { issues?: unknown[]; data?: unknown[] })?.data ??
        [];

    if (!Array.isArray(rows)) return [];

    return rows
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((row) => ({
        id: pickString(row, ["id"]) ?? "",
        title: pickString(row, ["title", "name"]) ?? "Untitled issue",
        state: pickString(row, ["state", "status"]),
        assignee_id: pickString(row, ["assignee_id", "assigneeId"]) ?? null,
        assignee_name: pickString(row, ["assignee_name", "assigneeName"]) ?? null,
        updated_at: pickString(row, ["updated_at", "updatedAt", "last_activity_at", "lastActivityAt"]),
        created_at: pickString(row, ["created_at", "createdAt"])
      }))
      .filter((issue) => issue.id);
  }

  async fetchWeeks(): Promise<ShipWeek[]> {
    const payload = await this.get<unknown>("/api/weeks");
    const rows = Array.isArray(payload)
      ? payload
      : (payload as { weeks?: unknown[]; data?: unknown[] })?.weeks ??
        (payload as { weeks?: unknown[]; data?: unknown[] })?.data ??
        [];

    if (!Array.isArray(rows)) return [];

    return rows
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((row) => ({
        id: pickString(row, ["id"]) ?? "",
        title: pickString(row, ["title", "name"]),
        start_date: pickString(row, ["start_date", "startDate"]),
        end_date: pickString(row, ["end_date", "endDate"]),
        status: pickString(row, ["status", "state"])
      }))
      .filter((week) => week.id);
  }
}

