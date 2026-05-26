import { describe, expect, test } from "bun:test";

import type {
  CursorClient,
  CursorDispatchRequest,
  CursorRunReference,
  CursorRunSnapshot,
} from "@tarmac/cursor-client";
import type { TarmacIssueUpdate } from "@tarmac/fp-domain";

import { TarmacOrchestrator, type FpClient, type OrchestratorIssue } from "../src";

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
    const issue = this.#find(issueId);
    if (issue === undefined) {
      throw new Error(`missing test issue ${issueId}`);
    }

    return issue;
  }

  async updateIssue(issueId: string, update: TarmacIssueUpdate): Promise<void> {
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

  #find(issueId: string): OrchestratorIssue | undefined {
    return Array.from(this.#issues.values()).find(
      (issue) => issue.id === issueId || issue.displayId === issueId,
    );
  }
}

class CapturingCursorClient implements CursorClient {
  requests: CursorDispatchRequest[] = [];
  readonly #runs = new Map<string, CursorRunSnapshot>();

  async dispatch(request: CursorDispatchRequest): Promise<CursorRunSnapshot> {
    this.requests.push(request);
    const run: CursorRunSnapshot = {
      agentId: "bc-00000000-0000-4000-8000-000000000001",
      runId: "run-00000000-0000-4000-8000-000000000001",
      status: "finished",
      repoUrl: request.repository.url,
      branch: "cursor/TARM-1",
      prUrl: "https://github.com/fiberplane/tarmac/pull/1",
      branches: [
        {
          repoUrl: request.repository.url,
          branch: "cursor/TARM-1",
          prUrl: "https://github.com/fiberplane/tarmac/pull/1",
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
  remoteUrl: "https://github.com/fiberplane/tarmac.git",
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
    const cursorClient = new CapturingCursorClient();
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient,
      repository,
      runnerId: "runner",
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
      url: "https://github.com/fiberplane/tarmac.git",
      startingRef: "abc123",
    });
    expect(updated.status).toBe("done");
    expect(updated.properties).toMatchObject({
      tarmac_state: "end",
      tarmac_agent_id: "bc-00000000-0000-4000-8000-000000000001",
      tarmac_run_id: "run-00000000-0000-4000-8000-000000000001",
      tarmac_base_sha: "abc123",
      tarmac_branch: "cursor/TARM-1",
      tarmac_pr_url: "https://github.com/fiberplane/tarmac/pull/1",
    });
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
    const cursorClient = new CapturingCursorClient();
    await cursorClient.dispatch({
      name: "TARM-1",
      prompt: "test",
      repository: {
        url: repository.remoteUrl,
        startingRef: repository.baseSha,
      },
    });
    const orchestrator = new TarmacOrchestrator({
      fpClient,
      cursorClient,
      repository,
    });

    await orchestrator.reconcile("TARM-1");

    expect((await fpClient.getIssue("issue-1")).properties).toMatchObject({
      tarmac_state: "end",
      tarmac_pr_url: "https://github.com/fiberplane/tarmac/pull/1",
    });
  });

  test("watch dispatches eligible issues in a bounded polling loop", async () => {
    const fpClient = new MemoryFpClient([issue()]);
    const cursorClient = new CapturingCursorClient();
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
