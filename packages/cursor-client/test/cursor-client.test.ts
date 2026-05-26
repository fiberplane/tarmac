import { describe, expect, test } from "bun:test";

import type { Run, SDKAgent } from "@cursor/sdk";

import {
  createCursorSdkClient,
  createFakeCursorClient,
  MissingCursorApiKeyError,
  normalizeRun,
  type CursorAgentNamespace,
} from "../src";

const makeRun = (overrides: Partial<Run> = {}): Run => ({
  id: "run-00000000-0000-4000-8000-000000000001",
  agentId: "bc-00000000-0000-4000-8000-000000000001",
  status: "running",
  supports: () => true,
  unsupportedReason: () => undefined,
  stream: async function* () {},
  conversation: async () => [],
  wait: async () => ({
    id: "run-00000000-0000-4000-8000-000000000001",
    status: "finished",
  }),
  cancel: async () => {},
  onDidChangeStatus: () => () => {},
  ...overrides,
});

const makeAgent = (
  run: Run,
  onSend: (prompt: string, options: unknown) => void,
  onDispose: () => void = () => {},
): SDKAgent => ({
  agentId: run.agentId,
  model: undefined,
  send: async (message, options) => {
    onSend(typeof message === "string" ? message : message.text, options);
    return run;
  },
  close: () => {},
  reload: async () => {},
  [Symbol.asyncDispose]: async () => {
    onDispose();
  },
  listArtifacts: async () => [],
  downloadArtifact: async () => Buffer.from(""),
});

describe("FakeCursorClient", () => {
  test("returns deterministic branch and PR-shaped run metadata", async () => {
    const client = createFakeCursorClient();

    const snapshot = await client.dispatch({
      name: "TARM-demo",
      prompt: "work ticket",
      repository: {
        url: "https://github.com/fiberplane/tarmac.git",
        startingRef: "main",
      },
    });

    expect(snapshot).toMatchObject({
      agentId: "bc-00000000-0000-4000-8000-000000000001",
      runId: "run-00000000-0000-4000-8000-000000000001",
      status: "finished",
      branch: "main",
      prUrl: "https://github.com/fiberplane/tarmac/pull/1",
    });
    await expect(
      client.getRun({
        agentId: snapshot.agentId,
        runId: snapshot.runId,
      }),
    ).resolves.toEqual(snapshot);
  });
});

describe("normalizeRun", () => {
  test("lifts the first git branch to the top-level snapshot fields", () => {
    const run = makeRun({
      status: "finished",
      result: "done",
      durationMs: 42,
      git: {
        branches: [
          {
            repoUrl: "https://github.com/fiberplane/tarmac.git",
            branch: "cursor/TARM-1",
            prUrl: "https://github.com/fiberplane/tarmac/pull/2",
          },
        ],
      },
    });

    expect(normalizeRun(run)).toEqual({
      agentId: run.agentId,
      runId: run.id,
      status: "finished",
      result: "done",
      durationMs: 42,
      repoUrl: "https://github.com/fiberplane/tarmac.git",
      branch: "cursor/TARM-1",
      prUrl: "https://github.com/fiberplane/tarmac/pull/2",
      branches: [
        {
          repoUrl: "https://github.com/fiberplane/tarmac.git",
          branch: "cursor/TARM-1",
          prUrl: "https://github.com/fiberplane/tarmac/pull/2",
        },
      ],
    });
  });
});

describe("CursorSdkClient", () => {
  test("creates a cloud agent with auto PR, env vars, and send idempotency", async () => {
    const calls: unknown[] = [];
    const run = makeRun({
      status: "running",
    });
    const agent = makeAgent(
      run,
      (prompt, options) => {
        calls.push({ kind: "send", prompt, options });
      },
      () => {
        calls.push({ kind: "dispose" });
      },
    );
    const agentNamespace: CursorAgentNamespace = {
      create: async (options) => {
        calls.push({ kind: "create", options });
        return agent;
      },
      getRun: async () => run,
    };
    const client = createCursorSdkClient({
      apiKey: "cursor-key",
      agentNamespace,
    });

    const snapshot = await client.dispatch({
      name: "TARM-1",
      prompt: "dispatch issue",
      repository: {
        url: "https://github.com/fiberplane/tarmac.git",
        startingRef: "main",
      },
      modelId: "composer-2",
      idempotencyKey: "claim-1",
      envVars: {
        FP_REMOTE: "rest-api",
      },
    });

    expect(snapshot).toMatchObject({
      agentId: run.agentId,
      runId: run.id,
      status: "running",
    });
    expect(calls).toEqual([
      {
        kind: "create",
        options: {
          apiKey: "cursor-key",
          name: "TARM-1",
          model: {
            id: "composer-2",
          },
          cloud: {
            repos: [
              {
                url: "https://github.com/fiberplane/tarmac.git",
                startingRef: "main",
              },
            ],
            autoCreatePR: true,
            envVars: {
              FP_REMOTE: "rest-api",
            },
          },
        },
      },
      {
        kind: "send",
        prompt: "dispatch issue",
        options: {
          idempotencyKey: "claim-1",
        },
      },
      {
        kind: "dispose",
      },
    ]);
  });

  test("gets cloud run state with the matching agent id", async () => {
    const run = makeRun({
      status: "finished",
    });
    const calls: unknown[] = [];
    const client = createCursorSdkClient({
      apiKey: "cursor-key",
      agentNamespace: {
        create: async () => makeAgent(run, () => {}),
        getRun: async (runId, options) => {
          calls.push({ runId, options });
          return run;
        },
      },
    });

    await expect(
      client.getRun({
        agentId: run.agentId,
        runId: run.id,
      }),
    ).resolves.toMatchObject({
      agentId: run.agentId,
      runId: run.id,
      status: "finished",
    });
    expect(calls).toEqual([
      {
        runId: run.id,
        options: {
          runtime: "cloud",
          agentId: run.agentId,
          apiKey: "cursor-key",
        },
      },
    ]);
  });

  test("fails closed without a Cursor API key", async () => {
    const originalKey = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;

    try {
      const client = createCursorSdkClient({
        agentNamespace: {
          create: async () => makeAgent(makeRun(), () => {}),
          getRun: async () => makeRun(),
        },
      });

      await expect(
        client.dispatch({
          name: "TARM-1",
          prompt: "dispatch issue",
          repository: {
            url: "https://github.com/fiberplane/tarmac.git",
          },
        }),
      ).rejects.toBeInstanceOf(MissingCursorApiKeyError);
    } finally {
      if (originalKey === undefined) {
        delete process.env.CURSOR_API_KEY;
      } else {
        process.env.CURSOR_API_KEY = originalKey;
      }
    }
  });
});
