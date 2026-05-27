import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
        fpClient: new MemoryFpClient([parentIssue(), childIssue(), readyLeafIssue()]),
      });

      expect(status.repository?.baseSha).toBe(repository.baseSha);
      expect(status.scan.source).toBe("live");
      expect(status.scan.eligible.some((issue) => issue.displayId === "TARM-LEAF")).toBe(true);
      expect(status.scan.ineligible.some((entry) => entry.issue.displayId === "TARM-PARENT")).toBe(
        true,
      );
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

describe("dashboard HTTP handlers", () => {
  test("serves status JSON and HTML UI", async () => {
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
        runs: readonly { command: string }[];
        scan: { source: string };
      };
      expect(payload.scan.source).toBe("cached");
      expect(payload.runs[0]?.command).toBe("daemon");

      const htmlResponse = await handlers.handleRequest(new Request("http://127.0.0.1/"));
      expect(htmlResponse.status).toBe(200);
      expect(await htmlResponse.text()).toContain("Tarmac orchestration dashboard");
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
