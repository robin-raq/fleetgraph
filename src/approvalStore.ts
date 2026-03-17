import { randomUUID } from "node:crypto";
import type { Finding, ShipTarget } from "./types";

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
  const all = Array.from(approvals.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!status) return all;
  return all.filter((item) => item.status === status);
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

