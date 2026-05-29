import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIssueQueue } from "../src/dashboard/grouping";
import { buildLogRows, buildRunTimeline } from "../src/dashboard/run-events";
import { createDashboardHandlers } from "../src/dashboard/server";
import { buildDashboardStatus } from "../src/dashboard/status";
import type { FpClient, OrchestratorIssue } from "../src/fp-client";
import { LocalRunStore } from "../src/local-state";

const repository = {
  remoteUrl: "https://github.com/example-org/tarmac.git",
  baseBranch: "main",
  baseSha: "abc123def456",
};

class MemoryFpClient implements FpClient {
  constructor(private readonly issues: readonly OrchestratorIssue[]) {}

  async listIssues(): Promise<readonly OrchestratorIssue[]> {
    return this.issues;
  }

  async getIssue(issueId: string): Promise<OrchestratorIssue> {
    const issue = this.issues.find((entry) => entry.id === issueId || entry.displayId === issueId);
    if (issue === undefined) {
      throw new Error(`missing issue ${issueId}`);
    }

    return issue;
  }

  async updateIssue(): Promise<void> {}
  async commentIssue(): Promise<void> {}
}

const parentIssue = (): OrchestratorIssue => ({
  id: "parent-1",
  displayId: "TARM-PARENT",
  title: "Epic parent",
  status: "todo",
  dependencies: [],
  properties: {
    tarmac_ready: "true",
  },
  comments: [],
});

const childIssue = (): OrchestratorIssue => ({
  id: "child-1",
  displayId: "TARM-CHILD",
  title: "Dispatch child",
  status: "in-progress",
  parent: "parent-1",
  dependencies: [],
  properties: {
    tarmac_ready: "true",
    tarmac_state: "active",
    tarmac_agent_id: "bc-00000000-0000-4000-8000-000000000001",
    tarmac_run_id: "run-00000000-0000-4000-8000-000000000001",
    tarmac_cursor_url: "https://cursor.com/agents/bc-00000000-0000-4000-8000-000000000001",
    tarmac_pr_url: "https://github.com/example-org/tarmac/pull/42",
    tarmac_pr_number: "42",
  },
  comments: [],
});

const readyLeafIssue = (): OrchestratorIssue => ({
  id: "leaf-1",
  displayId: "TARM-LEAF",
  title: "Ready leaf",
  status: "todo",
  dependencies: [],
  properties: {
    tarmac_ready: "true",
  },
  comments: [],
});

const doneIssue = (): OrchestratorIssue => ({
  id: "done-1",
  displayId: "TARM-DONE",
  title: "Finished issue",
  status: "done",
  dependencies: [],
  properties: {
    tarmac_state: "end",
  },
  comments: [],
});

const needsAttentionIssue = (): OrchestratorIssue => ({
  id: "attention-1",
  displayId: "TARM-ATTN",
  title: "Needs attention",
  status: "in-progress",
  dependencies: [],
  properties: {
    tarmac_state: "needs-attention",
    tarmac_last_error: "dispatch failed",
  },
  comments: [],
});

describe("buildIssueQueue", () => {
  test("assigns issues to deterministic operator buckets", () => {
    const scan = {
      source: "live" as const,
      eligible: [{ id: "leaf-1", displayId: "TARM-LEAF" }],
      ineligible: [
        {
          issue: { id: "parent-1", displayId: "TARM-PARENT" },
          reason: { kind: "blocked-by-open-child" as const, childId: "child-1" },
        },
      ],
    };

    const queue = buildIssueQueue(
      [
        { id: "child-1", displayId: "TARM-CHILD", tarmac: { state: "active" } },
        { id: "attention-1", displayId: "TARM-ATTN", tarmac: { state: "needs-attention" } },
        { id: "leaf-1", displayId: "TARM-LEAF" },
        { id: "parent-1", displayId: "TARM-PARENT" },
        { id: "done-1", displayId: "TARM-DONE", status: "done", tarmac: { state: "end" } },
        { id: "unknown-1", displayId: "TARM-UNK" },
      ],
      scan,
    );

    expect(queue.map((group) => group.id)).toEqual([
      "active",
      "needs-attention",
      "eligible",
      "blocked",
      "done",
      "unknown",
    ]);
    expect(queue.find((group) => group.id === "active")?.issues[0]?.displayId).toBe("TARM-CHILD");
    expect(queue.find((group) => group.id === "done")?.issues[0]?.displayId).toBe("TARM-DONE");
  });

  test("omits empty groups", () => {
    const queue = buildIssueQueue([{ id: "leaf-1", displayId: "TARM-LEAF" }], {
      source: "live",
      eligible: [{ id: "leaf-1", displayId: "TARM-LEAF" }],
      ineligible: [],
    });

    expect(queue).toEqual([
      {
        id: "eligible",
        label: "Eligible",
        issues: [{ id: "leaf-1", displayId: "TARM-LEAF" }],
      },
    ]);
  });
});

describe("buildDashboardStatus", () => {
  test("returns scan, bout, run, and dispatch metadata from local ledger", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "tarmac-dashboard-"));
    try {
      const store = new LocalRunStore({ stateRoot });
      const session = store.beginRun({
        command: "daemon",
        runnerId: "runner-test",
        repository,
        cursorMode: "fake",
      });
      await session.open();
      await session.record({
        type: "scan.finished",
        eligible: [{ issueId: "leaf-1", displayId: "TARM-LEAF" }],
        ineligible: [
          {
            issue: { issueId: "parent-1", displayId: "TARM-PARENT" },
            reason: "blocked-by-open-child",
          },
        ],
      });
      await session.record({
        type: "cursor.launch",
        issue: { issueId: "child-1", displayId: "TARM-CHILD" },
        claimId: "claim-1",
        cursorRun: {
          agentId: "bc-00000000-0000-4000-8000-000000000001",
          runId: "run-00000000-0000-4000-8000-000000000001",
          branch: "cursor/test",
          prUrl: "https://github.com/example-org/tarmac/pull/42",
          prNumber: "42",
        },
      });
      await session.record({
        type: "dispatch.failed",
        issue: { issueId: "leaf-1", displayId: "TARM-LEAF" },
        stage: "pre-launch",
        error: "claim lost",
      });
      await session.finish({
        status: "completed",
        summary: {
          iterations: 1,
          dispatchedCount: 1,
        },
      });

      const status = await buildDashboardStatus({
        stateRoot,
        runLimit: 5,
        eventLimit: 20,
        fpClient: new MemoryFpClient([
          parentIssue(),
          childIssue(),
          readyLeafIssue(),
          doneIssue(),
          needsAttentionIssue(),
        ]),
      });

      expect(status.repository?.baseSha).toBe(repository.baseSha);
      expect(status.scan.source).toBe("live");
      expect(status.scan.eligible.some((issue) => issue.displayId === "TARM-LEAF")).toBe(true);
      expect(status.scan.ineligible.some((entry) => entry.issue.displayId === "TARM-PARENT")).toBe(
        true,
      );
      expect(status.issueQueue.some((group) => group.id === "active")).toBe(true);
      expect(status.issueQueue.some((group) => group.id === "needs-attention")).toBe(true);
      expect(status.issueQueue.some((group) => group.id === "done")).toBe(true);
      expect(status.bouts).toHaveLength(1);
      expect(status.bouts[0]?.children.some((child) => child.displayId === "TARM-CHILD")).toBe(
        true,
      );
      expect(status.runs).toHaveLength(1);
      expect(status.runs[0]?.command).toBe("daemon");
      expect(
        status.runs[0]?.dispatches.some((dispatch) => dispatch.prUrl?.includes("/pull/42")),
      ).toBe(true);
      expect(status.runs[0]?.logExcerpt.some((line) => line.includes("cursor.launch"))).toBe(true);
      expect(status.runs[0]?.logRows.some((row) => row.type === "cursor.launch")).toBe(true);
      expect(status.runs[0]?.timeline.some((entry) => entry.label === "Cursor launched")).toBe(
        true,
      );
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  test("falls back to cached scan when live FP is unavailable", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "tarmac-dashboard-"));
    try {
      const store = new LocalRunStore({ stateRoot });
      const session = store.beginRun({
        command: "watch",
        runnerId: "runner-test",
        repository,
      });
      await session.open();
      await session.record({
        type: "scan.finished",
        eligible: [{ issueId: "leaf-1", displayId: "TARM-LEAF" }],
        ineligible: [],
      });
      await session.finish({ status: "completed", summary: { iterations: 1 } });

      const status = await buildDashboardStatus({
        stateRoot,
        fpClient: {
          listIssues: async () => {
            throw new Error("fp unavailable");
          },
          getIssue: async () => {
            throw new Error("fp unavailable");
          },
          updateIssue: async () => {},
          commentIssue: async () => {},
        },
      });

      expect(status.scan.source).toBe("cached");
      expect(status.scan.eligible).toHaveLength(1);
      expect(status.scan.eligible[0]?.displayId).toBe("TARM-LEAF");
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});

describe("run event read model", () => {
  test("builds structured timeline and log rows without parsing excerpt strings", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "tarmac-dashboard-events-"));
    try {
      const store = new LocalRunStore({ stateRoot });
      const session = store.beginRun({
        command: "run-one",
        runnerId: "runner-test",
        repository,
      });
      await session.open();
      await session.record({
        type: "dispatch.failed",
        issue: { issueId: "leaf-1", displayId: "TARM-LEAF" },
        stage: "pre-launch",
        error: "claim lost",
      });
      await session.finish({ status: "failed", summary: { error: "claim lost" } });

      const { events } = await store.readRunEvents(
        join(stateRoot, "runs", session.runId, "events.jsonl"),
        20,
      );

      const timeline = buildRunTimeline(events as never);
      const rows = buildLogRows(events as never, 20);

      expect(timeline.some((entry) => entry.label === "Dispatch failed")).toBe(true);
      expect(
        rows.some((row) => row.severity === "error" && row.message.includes("claim lost")),
      ).toBe(true);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  test("redacts sensitive tokens from structured log rows", async () => {
    const secret = "super-secret-token-value";
    const stateRoot = await mkdtemp(join(tmpdir(), "tarmac-dashboard-redact-"));
    try {
      const store = new LocalRunStore({
        stateRoot,
        redaction: {
          secrets: [{ name: "TEST_SECRET", value: secret }],
          forbiddenTerms: ["TEST_SECRET"],
        },
      });
      const session = store.beginRun({
        command: "daemon",
        runnerId: "runner-test",
        repository,
      });
      await session.open();
      await session.record({
        type: "dispatch.failed",
        issue: { issueId: "leaf-1", displayId: "TARM-LEAF" },
        stage: "pre-launch",
        error: `failed with ${secret}`,
      });
      await session.finish({ status: "failed", summary: { error: secret } });

      const status = await buildDashboardStatus({ stateRoot, runLimit: 1, eventLimit: 20 });
      const serialized = JSON.stringify(status.runs[0]?.logRows ?? []);
      expect(serialized.includes(secret)).toBe(false);
      expect(serialized.includes("[REDACTED_VALUE]")).toBe(true);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});

describe("dashboard HTTP handlers", () => {
  test("serves status JSON and operator console UI", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "tarmac-dashboard-http-"));
    try {
      const store = new LocalRunStore({ stateRoot });
      const session = store.beginRun({
        command: "daemon",
        runnerId: "runner-test",
        repository,
      });
      await session.open();
      await session.record({
        type: "scan.finished",
        eligible: [{ issueId: "leaf-1", displayId: "TARM-LEAF" }],
        ineligible: [],
      });
      await session.finish({ status: "completed", summary: { iterations: 1 } });

      const handlers = createDashboardHandlers({
        host: "127.0.0.1",
        port: 0,
        cwd: process.cwd(),
        stateRoot,
        runLimit: 5,
        eventLimit: 10,
        liveScan: false,
      });

      const statusResponse = await handlers.handleRequest(
        new Request("http://127.0.0.1/api/status"),
      );
      expect(statusResponse.status).toBe(200);
      const payload = (await statusResponse.json()) as {
        runs: readonly { command: string; timeline: readonly unknown[] }[];
        scan: { source: string };
        issueQueue: readonly { id: string }[];
      };
      expect(payload.scan.source).toBe("cached");
      expect(payload.runs[0]?.command).toBe("daemon");
      expect(payload.issueQueue.length).toBeGreaterThan(0);
      expect(payload.runs[0]?.timeline.length).toBeGreaterThan(0);

      const htmlResponse = await handlers.handleRequest(new Request("http://127.0.0.1/"));
      expect(htmlResponse.status).toBe(200);
      const html = await htmlResponse.text();
      expect(html).toContain("Local operator console");
      expect(html).toContain("Issue queue");
      expect(html).toContain("Read only");

      const cssResponse = await handlers.handleRequest(
        new Request("http://127.0.0.1/dashboard.css"),
      );
      expect(cssResponse.status).toBe(200);
      expect(await cssResponse.text()).toContain("--teal");

      const jsResponse = await handlers.handleRequest(new Request("http://127.0.0.1/dashboard.js"));
      expect(jsResponse.status).toBe(200);
      const js = await jsResponse.text();
      expect(js).toContain("issueQueue");
      expect(js).toContain("logRows");
      expect(js).not.toContain("run-one");
      expect(js).not.toContain("reconcile");
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
