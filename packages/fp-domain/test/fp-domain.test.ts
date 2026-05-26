import { describe, expect, test } from "bun:test";

import {
  buildOpenIssueIndex,
  confirmClaimOwnership,
  createClaimId,
  createClaimUpdate,
  decodeTarmacProperties,
  encodeTarmacProperties,
  isEligible,
  SameProcessClaimSet,
  type TarmacIssue,
} from "../src";

const issue = (overrides: Partial<TarmacIssue> = {}): TarmacIssue => ({
  id: "issue-1",
  displayId: "TARM-1",
  status: "todo",
  dependencies: [],
  properties: {
    tarmac_ready: "true",
  },
  ...overrides,
});

describe("decodeTarmacProperties", () => {
  test("uses locked defaults and ignores unknown keys", () => {
    const decoded = decodeTarmacProperties({
      unknown_key: "ignored",
    });

    expect(decoded).toEqual({
      kind: "valid",
      properties: {
        ready: "false",
        state: "idle",
      },
    });
  });

  test("decodes canonical wire values, not display labels", () => {
    const decoded = decodeTarmacProperties({
      tarmac_ready: "Ready",
    });

    expect(decoded.kind).toBe("invalid");
    if (decoded.kind === "invalid") {
      expect(decoded.failures[0]?.key).toBe("tarmac_ready");
      expect(decoded.failures[0]?.expected).toBe('"true" or "false"');
    }
  });

  test("decodes durable run metadata", () => {
    const decoded = decodeTarmacProperties({
      tarmac_ready: "true",
      tarmac_state: "active",
      tarmac_attempt: "2",
      tarmac_claim_id: "runner:2:claim",
      tarmac_agent_id: "bc-1",
      tarmac_run_id: "run-1",
      tarmac_cursor_url: "https://cursor.com/agents?id=bc-1",
      tarmac_branch: "cursor/TARM-1",
      tarmac_pr_url: "https://github.com/fiberplane/tarmac/pull/1",
      tarmac_pr_number: "1",
      tarmac_base_sha: "abc",
      tarmac_head_sha: "def",
      tarmac_last_error: "redacted",
    });

    expect(decoded).toEqual({
      kind: "valid",
      properties: {
        ready: "true",
        state: "active",
        attempt: "2",
        claimId: "runner:2:claim",
        agentId: "bc-1",
        runId: "run-1",
        cursorUrl: "https://cursor.com/agents?id=bc-1",
        branch: "cursor/TARM-1",
        prUrl: "https://github.com/fiberplane/tarmac/pull/1",
        prNumber: "1",
        baseSha: "abc",
        headSha: "def",
        lastError: "redacted",
      },
    });
  });

  test("encodes cursor run url metadata", () => {
    expect(
      encodeTarmacProperties({
        ready: "true",
        state: "active",
        agentId: "bc-1",
        runId: "run-1",
        cursorUrl: "https://cursor.com/agents?id=bc-1",
      }),
    ).toMatchObject({
      tarmac_agent_id: "bc-1",
      tarmac_run_id: "run-1",
      tarmac_cursor_url: "https://cursor.com/agents?id=bc-1",
    });
  });
});

describe("isEligible", () => {
  test("allows ready todo issue with terminal dependencies and no open children", () => {
    const candidate = issue({
      dependencies: ["closed-dep"],
    });
    const index = buildOpenIssueIndex([candidate]);

    expect(isEligible(candidate, index)).toEqual({
      kind: "eligible",
      value: {
        issue: candidate,
        claimBasis: {
          issueId: "issue-1",
          displayId: "TARM-1",
        },
      },
    });
  });

  test("blocks non-ready issues", () => {
    const candidate = issue({
      properties: {
        tarmac_ready: "false",
      },
    });

    expect(isEligible(candidate, buildOpenIssueIndex([candidate]))).toEqual({
      kind: "ineligible",
      reason: {
        kind: "not-ready",
      },
    });
  });

  test("blocks non-todo issues", () => {
    const candidate = issue({
      status: "in-progress",
    });

    expect(isEligible(candidate, buildOpenIssueIndex([candidate]))).toEqual({
      kind: "ineligible",
      reason: {
        kind: "not-todo",
        status: "in-progress",
      },
    });
  });

  test("blocks open dependencies", () => {
    const candidate = issue({
      dependencies: ["dep-1"],
    });
    const openDependency = issue({
      id: "dep-1",
      displayId: "TARM-2",
    });

    expect(isEligible(candidate, buildOpenIssueIndex([candidate, openDependency]))).toEqual({
      kind: "ineligible",
      reason: {
        kind: "blocked-by-dependency",
        dependencyId: "dep-1",
      },
    });
  });

  test("blocks open children", () => {
    const candidate = issue();
    const child = issue({
      id: "child-1",
      displayId: "TARM-2",
      parent: "issue-1",
    });

    expect(isEligible(candidate, buildOpenIssueIndex([candidate, child]))).toEqual({
      kind: "ineligible",
      reason: {
        kind: "blocked-by-open-child",
        childId: "child-1",
      },
    });
  });

  test("blocks malformed tarmac properties", () => {
    const candidate = issue({
      properties: {
        tarmac_ready: "true",
        tarmac_state: "launching",
      },
    });

    const result = isEligible(candidate, buildOpenIssueIndex([candidate]));

    expect(result.kind).toBe("ineligible");
    if (result.kind === "ineligible") {
      expect(result.reason.kind).toBe("malformed-tarmac-properties");
    }
  });

  test("blocks already running issues from same process index", () => {
    const candidate = issue();

    expect(isEligible(candidate, buildOpenIssueIndex([candidate]), new Set(["issue-1"]))).toEqual({
      kind: "ineligible",
      reason: {
        kind: "already-running",
      },
    });
  });

  test("blocks issues that already have cursor run metadata", () => {
    const candidate = issue({
      properties: {
        tarmac_ready: "true",
        tarmac_agent_id: "bc-1",
      },
    });

    expect(isEligible(candidate, buildOpenIssueIndex([candidate]))).toEqual({
      kind: "ineligible",
      reason: {
        kind: "already-dispatched",
      },
    });
  });
});

describe("claim helpers", () => {
  test("creates claim update intent", () => {
    const draft = {
      claimId: "claim",
      attempt: 3,
      runnerId: "runner",
    };

    expect(createClaimUpdate(draft)).toEqual({
      status: "in-progress",
      properties: {
        tarmac_ready: "true",
        tarmac_state: "active",
        tarmac_attempt: "3",
        tarmac_claim_id: "runner:3:claim",
      },
    });
  });

  test("confirms ownership only when claim matches and run ids are absent", () => {
    const claimId = createClaimId({
      claimId: "claim",
      attempt: 1,
      runnerId: "runner",
    });
    const claimedIssue = issue({
      properties: {
        tarmac_ready: "true",
        tarmac_state: "active",
        tarmac_claim_id: claimId,
      },
    });

    expect(confirmClaimOwnership(claimedIssue, claimId)).toEqual({
      kind: "confirmed",
    });
  });

  test("rejects lost claim ownership", () => {
    const claimedIssue = issue({
      properties: {
        tarmac_ready: "true",
        tarmac_claim_id: "other",
      },
    });

    expect(confirmClaimOwnership(claimedIssue, "mine")).toEqual({
      kind: "lost",
      reason: "claim-mismatch",
    });
  });

  test("rejects claim confirmation once cursor run ids exist", () => {
    const claimedIssue = issue({
      properties: {
        tarmac_ready: "true",
        tarmac_claim_id: "mine",
        tarmac_run_id: "run-1",
      },
    });

    expect(confirmClaimOwnership(claimedIssue, "mine")).toEqual({
      kind: "lost",
      reason: "already-dispatched",
    });
  });

  test("guards same-process duplicate claim attempts", () => {
    const claims = new SameProcessClaimSet();

    expect(claims.acquire("issue-1")).toBe(true);
    expect(claims.acquire("issue-1")).toBe(false);

    claims.release("issue-1");
    expect(claims.acquire("issue-1")).toBe(true);
  });
});
