import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CursorClient, CursorDispatchRequest, CursorRunSnapshot } from "@tarmac/cursor-client";
import { findSensitiveLeaks } from "@tarmac/worker-prompt";

import type { FpClient, OrchestratorIssue } from "../src/fp-client";
import {
  createRunSessionObserver,
  LocalRunStore,
  resolveRunEventsPath,
  resolveRunsLedgerPath,
} from "../src/local-state";
import { TarmacOrchestrator } from "../src/orchestrator";

const redaction = {
  forbiddenTerms: ["FP_TOKEN"],
  secrets: [
    {
      name: "FP_TOKEN",
      value: "fp_secret_456",
    },
  ],
};

const repository = {
  remoteUrl: "https://github.com/example-org/tarmac.git",
  baseBranch: "main",
  baseSha: "abc123",
};

class MemoryFpClient implements FpClient {
  readonly #issues = new Map<string, OrchestratorIssue>();

  constructor(issues: readonly OrchestratorIssue[]) {
    for (const issue of issues) {
      this.#issues.set(issue.id, issue);
    }
  }

  async listIssues(): Promise<readonly OrchestratorIssue[]> {
    return Array.from(this.#issues.values());
  }

  async getIssue(issueId: string): Promise<OrchestratorIssue> {
    const issue = [...this.#issues.values()].find(
      (entry) => entry.id === issueId || entry.displayId === issueId,
    );
    if (issue === undefined) {
      throw new Error(`missing issue ${issueId}`);
    }

    return issue;
  }

  async updateIssue(
    issueId: string,
    update: { status?: string; properties?: Record<string, string> },
  ): Promise<void> {
    const issue = await this.getIssue(issueId);
    this.#issues.set(issue.id, {
      ...issue,
      ...(update.status === undefined ? {} : { status: update.status }),
      properties: {
        ...issue.properties,
        ...update.properties,
      },
    });
  }

  async commentIssue(): Promise<void> {}
}

class FakeCursorClient implements CursorClient {
  async dispatch(request: CursorDispatchRequest): Promise<CursorRunSnapshot> {
    return {
      agentId: "bc-00000000-0000-4000-8000-000000000001",
      runId: "run-00000000-0000-4000-8000-000000000001",
      status: "finished",
      repoUrl: request.repository.url,
      branch: "cursor/test",
      prUrl: "https://github.com/example-org/tarmac/pull/1",
      branches: [],
    };
  }

  async getRun(): Promise<CursorRunSnapshot> {
    throw new Error("not implemented");
  }
}

const readyIssue = (): OrchestratorIssue => ({
  id: "issue-1",
  displayId: "TARM-1",
  title: "Ready issue",
  status: "todo",
  dependencies: [],
  properties: {
    tarmac_ready: "true",
  },
  comments: [],
});

describe("LocalRunStore", () => {
  test("writes redacted ledger and event logs for a watch session", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "tarmac-state-"));
    try {
      const store = new LocalRunStore({
        stateRoot,
        redaction,
      });
      const session = store.beginRun({
        command: "watch",
        runnerId: "runner-test",
        repository,
        cursorMode: "fake",
      });
      await session.open();
      await session.record({
        type: "dispatch.failed",
        issue: {
          issueId: "issue-1",
          displayId: "TARM-1",
        },
        stage: "pre-launch",
        error: "dispatch failed with FP_TOKEN=fp_secret_456",
      });
      await session.finish({
        status: "completed",
        summary: {
          iterations: 1,
          dispatchedCount: 0,
        },
      });

      const ledger = await readFile(resolveRunsLedgerPath(stateRoot), "utf8");
      expect(findSensitiveLeaks(ledger, redaction)).toEqual([]);

      const events = await readFile(resolveRunEventsPath(stateRoot, session.runId), "utf8");
      expect(findSensitiveLeaks(events, redaction)).toEqual([]);
      expect(events).toContain("dispatch.failed");
      expect(events).toContain("[REDACTED_VALUE]");
      expect(events).not.toContain("fp_secret_456");

      const runs = await store.listRecentRuns(5);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe("completed");
      expect(runs[0]?.summary?.iterations).toBe(1);
      expect(runs[0]?.eventsPath).toContain("runs/");
    } finally {
      await rm(stateRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  test("skips corrupt ledger lines when listing recent runs", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "tarmac-state-"));
    try {
      const store = new LocalRunStore({
        stateRoot,
      });
      const session = store.beginRun({
        command: "daemon",
        runnerId: "runner-test",
        repository,
      });
      await session.open();
      await session.finish({
        status: "completed",
      });

      const ledgerPath = resolveRunsLedgerPath(stateRoot);
      const ledger = await readFile(ledgerPath, "utf8");
      await Bun.write(ledgerPath, `${ledger}not valid json\n`);

      const runs = await store.listRecentRuns(10);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.command).toBe("daemon");
    } finally {
      await rm(stateRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  test("orchestrator watch persists scan and dispatch events through observer", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "tarmac-state-"));
    try {
      const store = new LocalRunStore({
        stateRoot,
        redaction,
      });
      const session = store.beginRun({
        command: "watch",
        runnerId: "runner-test",
        repository,
        cursorMode: "fake",
      });
      await session.open();
      const orchestrator = new TarmacOrchestrator({
        fpClient: new MemoryFpClient([readyIssue()]),
        cursorClient: new FakeCursorClient(),
        repository,
        runnerId: "runner-test",
        observer: createRunSessionObserver(session),
        redaction,
        cursorEnvVars: {
          FP_TOKEN: "fp_secret_456",
        },
      });

      await orchestrator.watch({
        maxIterations: 1,
      });
      await session.finish({
        status: "completed",
        summary: {
          iterations: 1,
          dispatchedCount: 1,
        },
      });

      const events = await store.readRunEvents(session.eventsPath, 50);
      const types = events.events.map((event) => event.type);
      expect(types).toContain("scan.started");
      expect(types).toContain("scan.finished");
      expect(types).toContain("claim.success");
      expect(types).toContain("cursor.launch");
      expect(types).toContain("metadata.persisted");
      expect(types).toContain("watch.iteration");

      const serialized = JSON.stringify(events.events);
      expect(findSensitiveLeaks(serialized, redaction)).toEqual([]);
    } finally {
      await rm(stateRoot, {
        recursive: true,
        force: true,
      });
    }
  });
});
