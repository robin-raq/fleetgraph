import { describe, it, expect, beforeEach } from "vitest";
import { computeDataHash, hasDataChanged, clearHashCache } from "./dataHash";
import type { ShipIssue, ShipStandup, ShipWeek } from "./types";
import type { ShipTeamMember } from "./shipClient";

const issues: ShipIssue[] = [
  { id: "1", title: "Bug fix", state: "todo", assignee_id: "u1" },
  { id: "2", title: "Feature", state: "done", assignee_id: "u2" },
];

const weeks: ShipWeek[] = [
  { id: "w1", title: "Sprint 5", status: "active", start_date: "2026-03-15", end_date: "2026-03-22" },
];

const standups: ShipStandup[] = [
  { id: "s1", user_id: "u1", week_id: "w1" },
];

const teamMembers: ShipTeamMember[] = [
  { id: "u1", name: "Alice" },
  { id: "u2", name: "Bob" },
];

beforeEach(() => {
  clearHashCache();
});

describe("computeDataHash", () => {
  it("returns a hex string", () => {
    const hash = computeDataHash(issues, weeks, standups, teamMembers);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it("returns the same hash for the same data", () => {
    const hash1 = computeDataHash(issues, weeks, standups, teamMembers);
    const hash2 = computeDataHash(issues, weeks, standups, teamMembers);
    expect(hash1).toBe(hash2);
  });

  it("returns a different hash when an issue changes state", () => {
    const hash1 = computeDataHash(issues, weeks, standups, teamMembers);
    const modifiedIssues = [{ ...issues[0], state: "in_progress" }, issues[1]];
    const hash2 = computeDataHash(modifiedIssues, weeks, standups, teamMembers);
    expect(hash1).not.toBe(hash2);
  });

  it("returns a different hash when an issue is added", () => {
    const hash1 = computeDataHash(issues, weeks, standups, teamMembers);
    const moreIssues = [...issues, { id: "3", title: "New", state: "todo" }];
    const hash2 = computeDataHash(moreIssues, weeks, standups, teamMembers);
    expect(hash1).not.toBe(hash2);
  });

  it("returns a different hash when a standup is added", () => {
    const hash1 = computeDataHash(issues, weeks, standups, teamMembers);
    const moreStandups = [...standups, { id: "s2", user_id: "u2", week_id: "w1" }];
    const hash2 = computeDataHash(issues, weeks, moreStandups, teamMembers);
    expect(hash1).not.toBe(hash2);
  });

  it("returns a different hash when sprint status changes", () => {
    const hash1 = computeDataHash(issues, weeks, standups, teamMembers);
    const modifiedWeeks = [{ ...weeks[0], status: "completed" }];
    const hash2 = computeDataHash(issues, modifiedWeeks, standups, teamMembers);
    expect(hash1).not.toBe(hash2);
  });
});

describe("hasDataChanged", () => {
  it("returns true on first call (no previous hash)", () => {
    const changed = hasDataChanged("prod", issues, weeks, standups, teamMembers);
    expect(changed).toBe(true);
  });

  it("returns false on second call with same data", () => {
    hasDataChanged("prod", issues, weeks, standups, teamMembers);
    const changed = hasDataChanged("prod", issues, weeks, standups, teamMembers);
    expect(changed).toBe(false);
  });

  it("returns true when data changes between calls", () => {
    hasDataChanged("prod", issues, weeks, standups, teamMembers);
    const modifiedIssues = [{ ...issues[0], state: "in_progress" }, issues[1]];
    const changed = hasDataChanged("prod", modifiedIssues, weeks, standups, teamMembers);
    expect(changed).toBe(true);
  });

  it("tracks separate hashes per target", () => {
    hasDataChanged("prod", issues, weeks, standups, teamMembers);
    // "local" has never been seen — should return true
    const changed = hasDataChanged("local", issues, weeks, standups, teamMembers);
    expect(changed).toBe(true);
  });

  it("returns false for both targets when data is unchanged", () => {
    hasDataChanged("prod", issues, weeks, standups, teamMembers);
    hasDataChanged("local", issues, weeks, standups, teamMembers);
    expect(hasDataChanged("prod", issues, weeks, standups, teamMembers)).toBe(false);
    expect(hasDataChanged("local", issues, weeks, standups, teamMembers)).toBe(false);
  });

  it("clearHashCache resets all targets", () => {
    hasDataChanged("prod", issues, weeks, standups, teamMembers);
    expect(hasDataChanged("prod", issues, weeks, standups, teamMembers)).toBe(false);
    clearHashCache();
    expect(hasDataChanged("prod", issues, weeks, standups, teamMembers)).toBe(true);
  });
});
