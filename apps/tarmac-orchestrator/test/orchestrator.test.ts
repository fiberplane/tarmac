import { describe, expect, test } from "bun:test";

import {
  inferCursorRunUrl,
  type CursorClient,
  type CursorDispatchRequest,
  type CursorRunReference,
  type CursorRunSnapshot,
} from "@tarmac/cursor-client";
import type { TarmacIssueUpdate } from "@tarmac/fp-domain";

import { TarmacOrchestrator, type FpClient, type OrchestratorIssue } from "../src";

const testCursorUrl = inferCursorRunUrl("bc-00000000-0000-4000-8000-000000000001");

class MemoryFpClient implements FpClient {
  readonly #issues = new Map<string, OrchestratorIssue>();
  failNextUpdateWhen: ((update: TarmacIssueUpdate) => boolean) | undefined;
  #failedUpdate = false;

  constructor(issues: readonly OrchestratorIssue[]) {
    for (const issue of issues) {
      this.#issues.set(issue.id, issue);
    }
  }

  async listIssues(): Promise<readonly OrchestratorIssue[]> {
    return Array.from(this.#issues.values());
  }

  async getIssue(issueId: string): Promise<OrchestratorIssue> {
    const issue = this.#find(issueId);
    if (issue === undefined) {
      throw new Error(`missing test issue ${issueId}`);
    }

    return issue;
  }

  async updateIssue(issueId: string, update: TarmacIssueUpdate): Promise<void> {
    if (
      this.failNextUpdateWhen !== undefined &&
      !this.#failedUpdate &&
      this.failNextUpdateWhen(update)
    ) {
      this.#failedUpdate = true;
      throw new Error("fp metadata write failed with FP_TOKEN=secret");
    }

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

  async commentIssue(issueId: string, comment: string): Promise<void> {
    const issue = await this.getIssue(issueId);
    this.#issues.set(issue.id, {
      ...issue,
      comments: [
        ...issue.comments,
        {
          author: "tarmac",
          body: comment,
        },
      ],
    });
  }

  #find(issueId: string): OrchestratorIssue | undefined {
    return Array.from(this.#issues.values()).find(
      (issue) => issue.id === issueId || issue.displayId === issueId,
    );
  }
}

class CapturingCursorClient implements CursorClient {
  requests: CursorDispatchRequest[] = [];
  readonly #runs = new Map<string, CursorRunSnapshot>();

  constructor(
    private readonly options: {
      readonly status?: CursorRunSnapshot["status"];
      readonly prUrl?: string;
      readonly failDispatch?: boolean;
    } = {},
  ) {}

  async dispatch(request: CursorDispatchRequest): Promise<CursorRunSnapshot> {
    if (this.options.failDispatch === true) {
      throw new Error("dispatch failed with FP_TOKEN=secret");
    }

    this.requests.push(request);
    const prUrl = this.options.prUrl;
    const run: CursorRunSnapshot = {
      agentId: "bc-00000000-0000-4000-8000-000000000001",
      runId: "run-00000000-0000-4000-8000-000000000001",
      status: this.options.status ?? "finished",
      repoUrl: request.repository.url,
      branch: "cursor/TARM-1",
      ...(prUrl === undefined ? {} : { prUrl }),
      branches: [
        {
          repoUrl: request.repository.url,
          branch: "cursor/TARM-1",
          ...(prUrl === undefined ? {} : { prUrl }),
        },
      ],
    };
    this.#runs.set(run.runId, run);
    return run;
  }

  async getRun(reference: CursorRunReference): Promise<CursorRunSnapshot> {
    const run = this.#runs.get(reference.runId);
    if (run === undefined || run.agentId !== reference.agentId) {
      throw new Error(`missing test run ${reference.agentId}/${reference.runId}`);
    }

    return run;
  }
}

const issue = (overrides: Partial<OrchestratorIssue> = {}): OrchestratorIssue => ({
  id: "issue-1",
  displayId: "TARM-1",
  title: "Dispatch demo issue",
  description: "Build the fake tracebullet.",
  status: "todo",
  dependencies: [],
  properties: {
    tarmac_ready: "true",
  },
  comments: [],
  ...overrides,
});

const repository = {
  remoteUrl: "https://github.com/example-org/tarmac.git",
  baseBranch: "main",
  baseSha: "abc123",
};

describe("TarmacOrchestrator", () => {
  test("scans only ready leaf todo issues as eligible", async () => {
    const fpClient = new MemoryFpClient([
      issue(),
      issue({
        id: "blocked",
        displayId: "TARM-2",
        dependencies: ["open-dep"],
      }),
      issue({
        id: "open-dep",
        displayId: "TARM-3",
      }),
    ]);
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient: new CapturingCursorClient(),
      repository,
      maxConcurrentRuns: 5,
    });

    const scan = await orchestrator.scan();

    expect(scan.eligible.map((entry) => entry.id)).toEqual(["issue-1", "open-dep"]);
    expect(scan.ineligible).toContainEqual({
      issue: await fpClient.getIssue("blocked"),
      reason: {
        kind: "blocked-by-dependency",
        dependencyId: "open-dep",
      },
    });
  });

  test("claims, renders a redacted prompt, dispatches, and persists run metadata", async () => {
    const fpClient = new MemoryFpClient([
      issue({
        description: "Do not leak fp_secret_456 or FP_TOKEN.",
      }),
    ]);
    const cursorClient = new CapturingCursorClient({
      prUrl: "https://github.com/example-org/tarmac/pull/1",
    });
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient,
      repository,
      runnerId: "runner",
      cursorEnvVars: {
        FP_REMOTE: "rest-api",
        FP_TOKEN: "fp_secret_456",
        FP_WORKSPACE: "fp-ws-fixture",
        FP_PROJECT_ID: "project",
        FP_SERVER_URL: "https://console.example",
      },
      redaction: {
        secrets: [
          {
            name: "FP_TOKEN",
            value: "fp_secret_456",
          },
        ],
      },
    });

    const result = await orchestrator.runOne("TARM-1");
    const updated = await fpClient.getIssue("issue-1");

    expect(result.cursorRun.status).toBe("finished");
    expect(cursorClient.requests[0]?.prompt).not.toContain("FP_TOKEN");
    expect(cursorClient.requests[0]?.prompt).not.toContain("fp_secret_456");
    expect(cursorClient.requests[0]?.repository).toEqual({
      url: "https://github.com/example-org/tarmac.git",
      startingRef: "main",
    });
    expect(cursorClient.requests[0]?.envVars).toEqual({
      FP_REMOTE: "rest-api",
      FP_TOKEN: "fp_secret_456",
      FP_WORKSPACE: "fp-ws-fixture",
      FP_PROJECT_ID: "project",
      FP_SERVER_URL: "https://console.example",
    });
    expect(updated.status).toBe("done");
    expect(updated.properties).toMatchObject({
      tarmac_state: "end",
      tarmac_agent_id: "bc-00000000-0000-4000-8000-000000000001",
      tarmac_run_id: "run-00000000-0000-4000-8000-000000000001",
      tarmac_cursor_url: testCursorUrl,
      tarmac_base_sha: "abc123",
      tarmac_branch: "cursor/TARM-1",
      tarmac_pr_url: "https://github.com/example-org/tarmac/pull/1",
    });
    expect(updated.comments[0]?.body).toBe(`Tarmac launched a Cursor Cloud run: ${testCursorUrl}`);
  });

  test("moves a claimed issue to needs-attention when dispatch fails", async () => {
    const fpClient = new MemoryFpClient([issue()]);
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient: new CapturingCursorClient({
        failDispatch: true,
      }),
      repository,
      redaction: {
        secrets: [
          {
            name: "FP_TOKEN",
            value: "secret",
          },
        ],
      },
    });

    await expect(orchestrator.runOne("TARM-1")).rejects.toThrow("dispatch failed");
    const updated = await fpClient.getIssue("issue-1");

    expect(updated.status).toBe("in-progress");
    expect(updated.properties).toMatchObject({
      tarmac_state: "needs-attention",
      tarmac_last_error: "dispatch failed with [REDACTED_SECRET]=[REDACTED_VALUE]",
    });
    expect(updated.comments[0]?.body).toContain("Tarmac dispatch failed before Cursor handoff");
    expect(updated.comments[0]?.body).not.toContain("FP_TOKEN");
    expect(updated.comments[0]?.body).not.toContain("secret");
  });

  test("does not mark a finished Cursor run done without PR evidence", async () => {
    const fpClient = new MemoryFpClient([issue()]);
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient: new CapturingCursorClient(),
      repository,
    });

    await orchestrator.runOne("TARM-1");
    const updated = await fpClient.getIssue("issue-1");

    expect(updated.status).toBe("in-progress");
    expect(updated.properties).toMatchObject({
      tarmac_state: "needs-attention",
      tarmac_last_error: "Cursor run finished without PR metadata.",
    });
  });

  test("records Cursor run ids when the post-launch FP metadata write fails", async () => {
    const fpClient = new MemoryFpClient([issue()]);
    fpClient.failNextUpdateWhen = (update) =>
      update.properties.tarmac_agent_id !== undefined && update.properties.tarmac_state === "end";
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient: new CapturingCursorClient({
        prUrl: "https://github.com/example-org/tarmac/pull/1",
      }),
      repository,
      redaction: {
        secrets: [
          {
            name: "FP_TOKEN",
            value: "secret",
          },
        ],
      },
    });

    await expect(orchestrator.runOne("TARM-1")).rejects.toThrow("fp metadata write failed");
    const updated = await fpClient.getIssue("issue-1");

    expect(updated.status).toBe("in-progress");
    expect(updated.properties).toMatchObject({
      tarmac_state: "needs-attention",
      tarmac_agent_id: "bc-00000000-0000-4000-8000-000000000001",
      tarmac_run_id: "run-00000000-0000-4000-8000-000000000001",
      tarmac_cursor_url: testCursorUrl,
      tarmac_base_sha: "abc123",
      tarmac_branch: "cursor/TARM-1",
      tarmac_pr_url: "https://github.com/example-org/tarmac/pull/1",
      tarmac_last_error:
        "Cursor launched but FP metadata persistence failed: fp metadata write failed with [REDACTED_SECRET]=[REDACTED_VALUE]",
    });
    expect(updated.comments[0]?.body).toContain(testCursorUrl);
    expect(updated.comments[0]?.body).toContain("Run metadata was recorded for reconciliation");
    expect(updated.comments[0]?.body).not.toContain("FP_TOKEN");
    expect(updated.comments[0]?.body).not.toContain("secret");
  });

  test("reconciles an existing Cursor run into FP state", async () => {
    const fpClient = new MemoryFpClient([
      issue({
        status: "in-progress",
        properties: {
          tarmac_ready: "true",
          tarmac_state: "active",
          tarmac_agent_id: "bc-00000000-0000-4000-8000-000000000001",
          tarmac_run_id: "run-00000000-0000-4000-8000-000000000001",
        },
      }),
    ]);
    const cursorClient = new CapturingCursorClient({
      prUrl: "https://github.com/example-org/tarmac/pull/1",
    });
    await cursorClient.dispatch({
      name: "TARM-1",
      prompt: "test",
      repository: {
        url: repository.remoteUrl,
        startingRef: repository.baseBranch,
      },
    });
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient,
      repository,
    });

    await orchestrator.reconcile("TARM-1");

    const reconciled = await fpClient.getIssue("issue-1");

    expect(reconciled.properties).toMatchObject({
      tarmac_state: "end",
      tarmac_cursor_url: testCursorUrl,
      tarmac_pr_url: "https://github.com/example-org/tarmac/pull/1",
    });
    expect(reconciled.comments[0]?.body).toBe(
      `Cursor run finished. Run: ${testCursorUrl}. PR: https://github.com/example-org/tarmac/pull/1`,
    );
  });

  test("adds terminal reconcile context once when a launch comment already has the run link", async () => {
    const fpClient = new MemoryFpClient([
      issue({
        status: "in-progress",
        properties: {
          tarmac_ready: "true",
          tarmac_state: "active",
          tarmac_agent_id: "bc-00000000-0000-4000-8000-000000000001",
          tarmac_run_id: "run-00000000-0000-4000-8000-000000000001",
          tarmac_cursor_url: testCursorUrl,
        },
        comments: [
          {
            author: "tarmac",
            body: `Tarmac launched a Cursor Cloud run: ${testCursorUrl}`,
          },
        ],
      }),
    ]);
    const cursorClient = new CapturingCursorClient({
      prUrl: "https://github.com/example-org/tarmac/pull/1",
    });
    await cursorClient.dispatch({
      name: "TARM-1",
      prompt: "test",
      repository: {
        url: repository.remoteUrl,
        startingRef: repository.baseBranch,
      },
    });
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient,
      repository,
    });

    await orchestrator.reconcile("TARM-1");
    await orchestrator.reconcile("TARM-1");

    const comments = (await fpClient.getIssue("issue-1")).comments;
    expect(comments).toHaveLength(2);
    expect(comments[1]?.body).toBe(
      `Cursor run finished. Run: ${testCursorUrl}. PR: https://github.com/example-org/tarmac/pull/1`,
    );
  });

  test("blocks parent issues while children are open", async () => {
    const fpClient = new MemoryFpClient([
      issue({
        id: "parent",
        displayId: "TARM-10",
      }),
      issue({
        id: "child",
        displayId: "TARM-11",
        parent: "parent",
      }),
    ]);
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient: new CapturingCursorClient({
        prUrl: "https://github.com/example-org/tarmac/pull/1",
      }),
      repository,
      maxConcurrentRuns: 2,
    });

    const scan = await orchestrator.scan();

    expect(scan.eligible.map((entry) => entry.id)).toEqual(["child"]);
    expect(scan.ineligible).toContainEqual({
      issue: await fpClient.getIssue("parent"),
      reason: {
        kind: "blocked-by-open-child",
        childId: "child",
      },
    });
    expect(scan.parentRollups).toEqual([
      {
        parentId: "parent",
        parentDisplayId: "TARM-10",
        openChildCount: 1,
        doneChildCount: 0,
        activeChildRunCount: 0,
        dispatchBlockedByOpenChildren: true,
      },
    ]);
  });

  test("watch respects global max concurrent runs across fp active metadata", async () => {
    const fpClient = new MemoryFpClient([
      issue({
        id: "running",
        displayId: "TARM-1",
        status: "in-progress",
        properties: {
          tarmac_ready: "true",
          tarmac_state: "active",
          tarmac_agent_id: "bc-00000000-0000-4000-8000-000000000001",
          tarmac_run_id: "run-00000000-0000-4000-8000-000000000001",
        },
      }),
      issue({ id: "ready-a", displayId: "TARM-2" }),
      issue({ id: "ready-b", displayId: "TARM-3" }),
    ]);
    const cursorClient = new CapturingCursorClient({
      prUrl: "https://github.com/example-org/tarmac/pull/1",
    });
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient,
      repository,
      maxConcurrentRuns: 1,
    });

    const result = await orchestrator.watch({
      maxIterations: 1,
    });

    expect(result.dispatched).toHaveLength(0);
    expect(cursorClient.requests).toHaveLength(0);

    const scan = await orchestrator.scan();
    expect(scan.activeRunCount).toBe(1);
    expect(scan.eligible).toHaveLength(0);
    expect(scan.ineligible).toContainEqual({
      issue: await fpClient.getIssue("ready-a"),
      reason: {
        kind: "blocked-by-capacity",
        activeRunCount: 1,
        maxConcurrentRuns: 1,
      },
    });
  });

  test("watch dispatches eligible issues in deterministic order up to capacity", async () => {
    const fpClient = new MemoryFpClient([
      issue({ id: "ready-c", displayId: "TARM-30" }),
      issue({ id: "ready-a", displayId: "TARM-10" }),
      issue({ id: "ready-b", displayId: "TARM-20" }),
    ]);
    const cursorClient = new CapturingCursorClient({
      prUrl: "https://github.com/example-org/tarmac/pull/1",
    });
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient,
      repository,
      maxConcurrentRuns: 2,
    });

    const result = await orchestrator.watch({
      maxIterations: 1,
    });

    expect(result.dispatched.map((entry) => entry.issue.id)).toEqual(["ready-a", "ready-b"]);
    expect(cursorClient.requests).toHaveLength(2);
  });

  test("watch dispatches eligible issues in a bounded polling loop", async () => {
    const fpClient = new MemoryFpClient([issue()]);
    const cursorClient = new CapturingCursorClient({
      prUrl: "https://github.com/example-org/tarmac/pull/1",
    });
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient,
      repository,
    });

    const result = await orchestrator.watch({
      maxIterations: 1,
    });

    expect(result.iterations).toBe(1);
    expect(result.dispatched).toHaveLength(1);
    expect(cursorClient.requests).toHaveLength(1);
  });
});
