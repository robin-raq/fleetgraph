import { describe, it, expect, beforeEach } from "vitest";
import { createApproval, listApprovals, updateApproval, clearApprovals } from "./approvalStore";
import type { Finding } from "./types";
import { config } from "./config";

const mockFinding: Finding = {
  id: "stale-1",
  category: "stale_issue",
  severity: "warning",
  title: "Stale issue: Test",
  detail: "Test detail",
  entityIds: ["1"]
};

describe("approvalStore", () => {
  beforeEach(() => {
    clearApprovals();
  });

  it("creates an approval with pending status", () => {
    const approval = createApproval("prod", [mockFinding]);
    expect(approval.id).toBeTruthy();
    expect(approval.status).toBe("pending");
    expect(approval.findings).toHaveLength(1);
    expect(approval.target).toBe("prod");
  });

  it("lists all approvals", () => {
    createApproval("prod", [mockFinding]);
    createApproval("local", [mockFinding]);
    const all = listApprovals();
    expect(all).toHaveLength(2);
  });

  it("filters approvals by status", () => {
    const pending = listApprovals("pending");
    expect(pending.every((a) => a.status === "pending")).toBe(true);
  });

  it("updates approval to approved", () => {
    const approval = createApproval("prod", [mockFinding]);
    const updated = updateApproval(approval.id, "approved");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("approved");
  });

  it("updates approval to rejected", () => {
    const approval = createApproval("prod", [mockFinding]);
    const updated = updateApproval(approval.id, "rejected");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("rejected");
  });

  it("returns null for nonexistent approval", () => {
    const result = updateApproval("nonexistent-id", "approved");
    expect(result).toBeNull();
  });

  it("caps the approval queue to the configured max size", () => {
    const startSize = listApprovals().length;
    const createCount = config.maxApprovalRecords + 5;

    for (let i = 0; i < createCount; i += 1) {
      createApproval("prod", [{ ...mockFinding, id: `stale-${i}` }]);
    }

    const all = listApprovals();
    expect(all.length).toBeLessThanOrEqual(config.maxApprovalRecords);
    expect(all.length).toBeGreaterThanOrEqual(Math.min(startSize, config.maxApprovalRecords));
  });
});
