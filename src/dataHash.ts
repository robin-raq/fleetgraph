import { createHash } from "node:crypto";
import type { ShipIssue, ShipStandup, ShipWeek } from "./types";
import type { ShipTeamMember } from "./shipClient";
import type { ShipTarget } from "./types";

/**
 * Compute a SHA-256 hash of the fetched Ship data.
 * Used to skip the analyze/LLM step when nothing has changed since the last poll.
 */
export function computeDataHash(
  issues: ShipIssue[],
  weeks: ShipWeek[],
  standups: ShipStandup[],
  teamMembers: ShipTeamMember[]
): string {
  const payload = JSON.stringify({ issues, weeks, standups, teamMembers });
  return createHash("sha256").update(payload).digest("hex");
}

const lastHashes = new Map<ShipTarget, string>();

/**
 * Returns true if the data has changed since the last call for this target.
 * Always returns true on the first call (no previous hash to compare).
 */
export function hasDataChanged(
  target: ShipTarget,
  issues: ShipIssue[],
  weeks: ShipWeek[],
  standups: ShipStandup[],
  teamMembers: ShipTeamMember[]
): boolean {
  const currentHash = computeDataHash(issues, weeks, standups, teamMembers);
  const previousHash = lastHashes.get(target);
  lastHashes.set(target, currentHash);
  return currentHash !== previousHash;
}

/** Clear all cached hashes. Useful for testing. */
export function clearHashCache(): void {
  lastHashes.clear();
}
