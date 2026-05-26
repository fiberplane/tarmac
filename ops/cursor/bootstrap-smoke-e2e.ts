#!/usr/bin/env bun
import { setTimeout as sleep } from "node:timers/promises";

import { buildCursorWorkerEnv } from "../../apps/tarmac-orchestrator/src/launch-config";
import { readRepositoryContext } from "../../apps/tarmac-orchestrator/src/repository";
import {
  createCursorSdkClient,
  type CursorDispatchRequest,
  type CursorRunSnapshot,
} from "../../packages/cursor-client/src";
import {
  findSensitiveLeaks,
  redactSensitiveText,
  type PromptRedactionConfig,
  type PromptSecret,
} from "../../packages/worker-prompt/src";

const REQUIRED_ENV = [
  "CURSOR_API_KEY",
  "FP_TOKEN",
  "FP_WORKSPACE",
  "FP_PROJECT_ID",
  "FP_SERVER_URL",
] as const;

const TERMINAL_STATUSES = new Set(["finished", "error", "cancelled"]);
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 10 * 1000;
const MIN_POLL_INTERVAL_MS = 1_000;
const SECRET_ENV_NAMES = [
  "CURSOR_API_KEY",
  "FP_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PAT",
] as const;

const writeOut = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const writeErr = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const secretForEnv = (name: string): PromptSecret => {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? { name } : { name, value };
};

const redactionConfig = (): PromptRedactionConfig => ({
  secrets: SECRET_ENV_NAMES.map(secretForEnv),
});

const redactForOutput = (message: string): string =>
  redactSensitiveText(message, redactionConfig());

const fail = (message: string): never => {
  writeErr(redactForOutput(message));
  process.exit(1);
};

const skip = (message: string): never => {
  writeOut(`SKIP: ${message}`);
  process.exit(0);
};

const requiredEnvValue = (name: string, help: string): string => {
  const value = process.env[name]?.trim();
  if (value !== undefined && value !== "") {
    return value;
  }

  fail(help);
  return "";
};

const missingRequiredEnv = (): readonly string[] =>
  REQUIRED_ENV.filter((name) => {
    const value = process.env[name]?.trim();
    return value === undefined || value === "";
  });

const parsePositiveIntegerEnv = (name: string, defaultValue: number, minimum: number): number => {
  const raw = process.env[name]?.trim();
  const value = raw === undefined || raw === "" ? defaultValue : Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${name} must be an integer greater than or equal to ${minimum}.`);
  }

  return value;
};

const renderPrompt = (issueId: string): string =>
  [
    "You are running a read-only Tarmac Cursor Cloud bootstrap smoke test.",
    "",
    "Do not edit files, commit, push, open a PR, or print secret values.",
    "Do not print values for CURSOR_API_KEY, FP_TOKEN, GitHub tokens, or dotenv secrets.",
    "",
    "Verify these repo-local checks:",
    "- `.cursor/environment.json` exists.",
    "- `.cursor/skills/fp-ticket/SKILL.md` exists.",
    "- `bun --version` runs.",
    "- `fp --version` runs.",
    "",
    "Verify this FP REST/no-clone check from outside the repo:",
    "- Create `/tmp/tarmac-cursor-bootstrap-smoke` if needed.",
    `- From that directory, run FP REST mode and read issue ${issueId} as JSON.`,
    "- Confirm the issue id/title is visible without printing token values.",
    "",
    "When complete, respond with a short JSON object containing:",
    `{"marker":"BOOTSTRAP_SMOKE_OK","issue":"${issueId}","repoSkills":true,"fpRestRead":true}`,
  ].join("\n");

const waitForTerminalRun = async (
  initial: CursorRunSnapshot,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<CursorRunSnapshot> => {
  const client = createCursorSdkClient();
  const deadline = Date.now() + timeoutMs;
  let current = initial;

  while (!TERMINAL_STATUSES.has(current.status)) {
    if (Date.now() >= deadline) {
      fail(`Timed out waiting for Cursor run ${current.runId}`);
    }

    await sleep(pollIntervalMs);
    current = await client.getRun({
      agentId: current.agentId,
      runId: current.runId,
    });
    writeOut(`Cursor run ${current.runId} status: ${current.status}`);
  }

  return current;
};

const assertNoSensitiveLeaks = (text: string, context: string): void => {
  const leaks = findSensitiveLeaks(text, redactionConfig());
  if (leaks.length > 0) {
    fail(`${context} contained ${leaks.length} sensitive token name/value marker(s).`);
  }
};

type BootstrapSmokeResult = {
  readonly marker?: unknown;
  readonly issue?: unknown;
  readonly repoSkills?: unknown;
  readonly fpRestRead?: unknown;
};

const parseBootstrapSmokeResult = (text: string): BootstrapSmokeResult => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return fail("Cursor bootstrap run finished without a JSON result object.");
  }

  try {
    return JSON.parse(text.slice(start, end + 1)) as BootstrapSmokeResult;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return fail(`Cursor bootstrap run returned invalid JSON: ${message}`);
  }
};

const assertBootstrapSmokeResult = (text: string, issueId: string): void => {
  assertNoSensitiveLeaks(text, "Cursor bootstrap result");
  const result = parseBootstrapSmokeResult(text);
  if (
    result.marker !== "BOOTSTRAP_SMOKE_OK" ||
    result.issue !== issueId ||
    result.repoSkills !== true ||
    result.fpRestRead !== true
  ) {
    fail("Cursor bootstrap run JSON result did not match the expected proof contract.");
  }
};

const main = async (): Promise<void> => {
  if (process.env.TARMAC_CURSOR_BOOTSTRAP_E2E !== "1") {
    skip("set TARMAC_CURSOR_BOOTSTRAP_E2E=1 to run the Cursor bootstrap proof");
  }

  const missing = missingRequiredEnv();
  if (missing.length > 0) {
    fail(`Missing required Cursor bootstrap env names: ${missing.join(", ")}`);
  }

  const issueId = requiredEnvValue(
    "TARMAC_CURSOR_BOOTSTRAP_ISSUE_ID",
    "Set TARMAC_CURSOR_BOOTSTRAP_ISSUE_ID to a readable FP issue ID.",
  );
  const timeoutMs = parsePositiveIntegerEnv(
    "TARMAC_CURSOR_BOOTSTRAP_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
    1,
  );
  const pollIntervalMs = parsePositiveIntegerEnv(
    "TARMAC_CURSOR_BOOTSTRAP_POLL_MS",
    DEFAULT_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
  );
  const repository = await readRepositoryContext(process.cwd(), {
    requireLocalHeadAtRemote: true,
  });
  const cursorClient = createCursorSdkClient();
  const envVars = buildCursorWorkerEnv("real");
  const request: CursorDispatchRequest = {
    name: `Tarmac bootstrap smoke ${issueId}`,
    prompt: renderPrompt(issueId),
    repository: {
      url: repository.remoteUrl,
      startingRef: repository.baseBranch,
    },
    autoCreatePR: false,
    ...(envVars === undefined ? {} : { envVars }),
  };
  const run = await cursorClient.dispatch(request);

  writeOut(`Cursor bootstrap run launched: ${run.agentId}/${run.runId}`);
  const terminal = await waitForTerminalRun(run, timeoutMs, pollIntervalMs);
  if (terminal.status !== "finished") {
    fail(`Cursor bootstrap run ended with status ${terminal.status}`);
  }
  const resultText =
    terminal.result ?? fail("Cursor bootstrap run finished without a result payload.");
  assertBootstrapSmokeResult(resultText, issueId);

  writeOut("PASS: Cursor bootstrap smoke completed without exposing secret values.");
};

await main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  fail(`Cursor bootstrap proof failed: ${message}`);
});
