import { describe, it, expect } from "vitest";
import { createApproval, listApprovals, updateApproval } from "./approvalStore";
import type { Finding } from "./types";

const mockFinding: Finding = {
  id: "stale-1",
  category: "stale_issue",
  severity: "warning",
  title: "Stale issue: Test",
  detail: "Test detail",
  entityIds: ["1"]
};

describe("approvalStore", () => {
  it("creates an approval with pending status", () => {
    const approval = createApproval("prod", [mockFinding]);
    expect(approval.id).toBeTruthy();
    expect(approval.status).toBe("pending");
    expect(approval.findings).toHaveLength(1);
    expect(approval.target).toBe("prod");
  });

  it("lists all approvals", () => {
    const all = listApprovals();
    expect(all.length).toBeGreaterThanOrEqual(1);
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
});
