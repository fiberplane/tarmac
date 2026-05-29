#!/usr/bin/env bun
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REQUIRED_ENV = ["FP_TOKEN", "FP_WORKSPACE", "FP_PROJECT_ID", "FP_SERVER_URL"] as const;
const DEFAULT_WORKDIR = "/tmp/tarmac-fp-rest-attach-e2e";
const MIN_FP_VERSION = "0.24.0-next.a23eb4e";
const MIN_FP_COMMIT = "a23eb4e";

/** 1x1 transparent PNG */
const PROBE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const writeOut = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const writeErr = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const fail = (message: string): never => {
  writeErr(message);
  process.exit(1);
};

const skip = (message: string): never => {
  writeOut(`SKIP: ${message}`);
  process.exit(0);
};

const runFp = async (args: readonly string[], cwd: string): Promise<string> => {
  const result = await execFileAsync("fp", [...args], {
    cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return `${result.stdout}${result.stderr}`;
};

const assertFpVersion = (versionOutput: string): void => {
  if (!versionOutput.includes(MIN_FP_COMMIT)) {
    fail(
      `fp --version must include REST attach support (${MIN_FP_VERSION}); got: ${versionOutput.trim()}`,
    );
  }
};

const main = async (): Promise<void> => {
  if (process.env.TARMAC_FP_REST_ATTACH_E2E !== "1") {
    skip("set TARMAC_FP_REST_ATTACH_E2E=1 to run the FP REST attach proof");
  }

  const missingEnv = REQUIRED_ENV.filter((name) => process.env[name] === undefined);
  if (missingEnv.length > 0) {
    fail(`Missing required REST env names: ${missingEnv.join(", ")}`);
  }

  const cwd = process.env.TARMAC_FP_REST_ATTACH_WORKDIR ?? DEFAULT_WORKDIR;
  await mkdir(cwd, { recursive: true });

  writeOut(`Running FP REST attach proof from ${cwd}`);
  if (process.env.FP_REMOTE === undefined || process.env.FP_REMOTE.trim() === "") {
    fail("FP_REMOTE must be set for REST no-clone attach proof.");
  }

  writeOut(`Required env names present: FP_REMOTE, ${REQUIRED_ENV.join(", ")}`);

  const versionOutput = await runFp(["--version"], cwd);
  assertFpVersion(versionOutput);
  writeOut(`fp version OK (${MIN_FP_VERSION} or newer REST-capable build).`);

  const probePath = `${cwd}/attach-probe.png`;
  await writeFile(probePath, PROBE_PNG);

  const attachOutput = await runFp(["attach", probePath], cwd);
  if (!attachOutput.includes("fp-asset://")) {
    fail("fp attach did not return an fp-asset:// markdown reference in REST no-clone mode.");
  }

  writeOut("PASS: fp attach works from REST no-clone mode without a repo-local .fp project.");
};

await main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  fail(`FP REST attach proof failed: ${message}`);
});
