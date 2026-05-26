import type { TarmacIssue, TarmacIssueUpdate } from "./models";
import { decodeTarmacProperties } from "./properties";

export type ClaimDraft = {
  readonly claimId: string;
  readonly attempt: number;
  readonly runnerId: string;
};

export type ClaimConfirmation =
  | {
      readonly kind: "confirmed";
    }
  | {
      readonly kind: "lost";
      readonly reason: "claim-mismatch" | "already-dispatched" | "malformed-properties";
    };

export class SameProcessClaimSet {
  readonly #issueIds = new Set<string>();

  acquire(issueId: string): boolean {
    if (this.#issueIds.has(issueId)) {
      return false;
    }

    this.#issueIds.add(issueId);
    return true;
  }

  release(issueId: string): void {
    this.#issueIds.delete(issueId);
  }
}

export const createClaimId = (draft: ClaimDraft): string =>
  `${draft.runnerId}:${draft.attempt}:${draft.claimId}`;

export const createClaimUpdate = (draft: ClaimDraft): TarmacIssueUpdate => ({
  status: "in-progress",
  properties: {
    tarmac_ready: "true",
    tarmac_state: "active",
    tarmac_attempt: String(draft.attempt),
    tarmac_claim_id: createClaimId(draft),
  },
});

export const confirmClaimOwnership = (
  issue: TarmacIssue,
  expectedClaimId: string,
): ClaimConfirmation => {
  const decoded = decodeTarmacProperties(issue.properties);
  if (decoded.kind === "invalid") {
    return {
      kind: "lost",
      reason: "malformed-properties",
    };
  }

  if (decoded.properties.claimId !== expectedClaimId) {
    return {
      kind: "lost",
      reason: "claim-mismatch",
    };
  }

  if (decoded.properties.agentId !== undefined || decoded.properties.runId !== undefined) {
    return {
      kind: "lost",
      reason: "already-dispatched",
    };
  }

  return {
    kind: "confirmed",
  };
};
