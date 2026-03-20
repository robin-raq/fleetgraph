import { randomUUID } from "node:crypto";
import type { Finding, ShipTarget } from "./types";
import { config } from "./config";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  target: ShipTarget;
  findings: Finding[];
  status: ApprovalStatus;
}

const approvals = new Map<string, ApprovalRecord>();

export function createApproval(target: ShipTarget, findings: Finding[]): ApprovalRecord {
  while (approvals.size >= config.maxApprovalRecords) {
    const oldestId = approvals.keys().next().value;
    if (oldestId) approvals.delete(oldestId);
    else break;
  }

  const now = new Date().toISOString();
  const record: ApprovalRecord = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    target,
    findings,
    status: "pending"
  };
  approvals.set(record.id, record);
  return record;
}

export function listApprovals(status?: ApprovalStatus): ApprovalRecord[] {
  // Map preserves insertion order (oldest first); reverse gives newest-first — O(n) vs sort's O(n log n)
  const all = Array.from(approvals.values()).reverse();
  if (!status) return all;
  return all.filter((item) => item.status === status);
}

/** Clear all approvals. Useful for testing. */
export function clearApprovals(): void {
  approvals.clear();
}

export function updateApproval(id: string, status: Exclude<ApprovalStatus, "pending">): ApprovalRecord | null {
  const current = approvals.get(id);
  if (!current) return null;
  const next: ApprovalRecord = {
    ...current,
    status,
    updatedAt: new Date().toISOString()
  };
  approvals.set(id, next);
  return next;
}

