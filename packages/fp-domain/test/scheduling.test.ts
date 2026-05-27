import { describe, expect, test } from "bun:test";

import {
  buildActiveRunSnapshot,
  collectFpActiveRunIssueIds,
  compareDispatchOrder,
  hasFpActiveCursorRun,
  parseMaxConcurrentRuns,
  partitionByCapacity,
  rollupParentBouts,
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

describe("parseMaxConcurrentRuns", () => {
  test("defaults to one when unset or invalid", () => {
    expect(parseMaxConcurrentRuns(undefined)).toBe(1);
    expect(parseMaxConcurrentRuns("")).toBe(1);
    expect(parseMaxConcurrentRuns("0")).toBe(1);
    expect(parseMaxConcurrentRuns("nope")).toBe(1);
  });

  test("parses positive integers", () => {
    expect(parseMaxConcurrentRuns("3")).toBe(3);
  });
});

describe("hasFpActiveCursorRun", () => {
  test("counts in-progress issues with cursor run metadata", () => {
    expect(
      hasFpActiveCursorRun(
        issue({
          status: "in-progress",
          properties: {
            tarmac_ready: "true",
            tarmac_state: "active",
            tarmac_agent_id: "bc-1",
            tarmac_run_id: "run-1",
          },
        }),
      ),
    ).toBe(true);
  });

  test("ignores terminal done issues and end state", () => {
    expect(
      hasFpActiveCursorRun(
        issue({
          status: "done",
          properties: {
            tarmac_ready: "true",
            tarmac_state: "end",
            tarmac_agent_id: "bc-1",
            tarmac_run_id: "run-1",
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("buildActiveRunSnapshot", () => {
  test("merges fp metadata runs with same-process claims without double counting", () => {
    const claims = new SameProcessClaimSet();
    claims.acquire("claiming");

    const snapshot = buildActiveRunSnapshot(
      [
        issue({
          id: "running",
          displayId: "TARM-2",
          status: "in-progress",
          properties: {
            tarmac_ready: "true",
            tarmac_state: "active",
            tarmac_agent_id: "bc-1",
            tarmac_run_id: "run-1",
          },
        }),
        issue({
          id: "claiming",
          displayId: "TARM-3",
        }),
      ],
      claims,
    );

    expect(snapshot.count).toBe(2);
    expect(snapshot.issueIds).toEqual(new Set(["running", "claiming"]));
  });
});

describe("partitionByCapacity", () => {
  test("defers eligible issues beyond available slots in deterministic order", () => {
    const issues = [
      issue({ id: "c", displayId: "TARM-3" }),
      issue({ id: "a", displayId: "TARM-1" }),
      issue({ id: "b", displayId: "TARM-2" }),
    ];

    const { dispatchable, deferred } = partitionByCapacity(issues, 0, 2);

    expect(dispatchable.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(deferred.map((entry) => entry.id)).toEqual(["c"]);
    expect(compareDispatchOrder(issues[1]!, issues[0]!)).toBeLessThan(0);
  });
});

describe("rollupParentBouts", () => {
  test("summarizes open children and active child runs for parents", () => {
    const parent = issue({ id: "parent", displayId: "TARM-10" });
    const openChild = issue({
      id: "child-open",
      displayId: "TARM-11",
      parent: "parent",
    });
    const activeChild = issue({
      id: "child-active",
      displayId: "TARM-12",
      parent: "parent",
      status: "in-progress",
      properties: {
        tarmac_ready: "true",
        tarmac_state: "active",
        tarmac_agent_id: "bc-1",
        tarmac_run_id: "run-1",
      },
    });
    const doneChild = issue({
      id: "child-done",
      displayId: "TARM-13",
      parent: "parent",
      status: "done",
    });

    expect(rollupParentBouts([parent, openChild, activeChild, doneChild])).toEqual([
      {
        parentId: "parent",
        parentDisplayId: "TARM-10",
        openChildCount: 2,
        doneChildCount: 1,
        activeChildRunCount: 1,
        dispatchBlockedByOpenChildren: true,
      },
    ]);
  });
});

describe("collectFpActiveRunIssueIds", () => {
  test("returns only conservative active fp runs", () => {
    expect(
      collectFpActiveRunIssueIds([
        issue({
          id: "active",
          status: "in-progress",
          properties: {
            tarmac_ready: "true",
            tarmac_state: "active",
            tarmac_agent_id: "bc-1",
          },
        }),
        issue({ id: "idle" }),
      ]),
    ).toEqual(new Set(["active"]));
  });
});
