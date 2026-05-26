#!/usr/bin/env bun
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";

import { Schema } from "effect";

import { TARMAC_PROPERTY_KEYS, type TarmacPropertyKey } from "../../packages/fp-domain/src";

const execFileAsync = promisify(execFile);

const REQUIRED_ENV = ["FP_TOKEN", "FP_WORKSPACE", "FP_PROJECT_ID", "FP_SERVER_URL"] as const;
const DEFAULT_WORKDIR = "/tmp/tarmac-fp-rest-e2e";

const FpIssue = Schema.Struct({
  properties: Schema.Record({
    key: Schema.String,
    value: Schema.Unknown,
  }),
});

type FpIssue = Schema.Schema.Type<typeof FpIssue>;

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

const requiredEnvValue = (name: string, help: string): string => {
  const value = process.env[name]?.trim();
  if (value !== undefined && value !== "") {
    return value;
  }

  fail(help);
  return "";
};

const runFp = async (args: readonly string[], cwd: string): Promise<string> => {
  const result = await execFileAsync("fp", [...args], {
    cwd,
    env: {
      ...process.env,
      FP_REMOTE: "rest-api",
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
};

const readIssue = async (issueId: string, cwd: string): Promise<FpIssue> =>
  Schema.decodeUnknownSync(FpIssue)(
    JSON.parse(await runFp(["issue", "show", issueId, "--format", "json"], cwd)),
  );

type RestoreEntry = {
  readonly key: TarmacPropertyKey;
  readonly originalValue?: string;
};

const restorePlan = (properties: Readonly<Record<string, unknown>>): readonly RestoreEntry[] =>
  TARMAC_PROPERTY_KEYS.map((key) => {
    const value = properties[key];
    return typeof value === "string"
      ? {
          key,
          originalValue: value,
        }
      : {
          key,
        };
  });

const propertyArgs = (values: Readonly<Record<TarmacPropertyKey, string>>): readonly string[] =>
  Object.entries(values).flatMap(([key, value]) => ["--property", `${key}=${value}`]);

const restoreArgs = (entries: readonly RestoreEntry[]): readonly string[] =>
  entries.flatMap((entry) => [
    "--property",
    entry.originalValue === undefined ? `${entry.key}=` : `${entry.key}=${entry.originalValue}`,
  ]);

const verifyRestored = (entries: readonly RestoreEntry[], restored: FpIssue): readonly string[] =>
  entries.flatMap((entry) => {
    const restoredValue = restored.properties[entry.key];
    if (entry.originalValue === undefined) {
      return restoredValue === undefined || restoredValue === "" ? [] : [entry.key];
    }

    return restoredValue === entry.originalValue ? [] : [entry.key];
  });

const probeValues = (): Readonly<Record<TarmacPropertyKey, string>> => {
  const suffix = Date.now().toString();
  return {
    tarmac_ready: "true",
    tarmac_state: "active",
    tarmac_attempt: "1",
    tarmac_claim_id: `rest-probe:1:${suffix}`,
    tarmac_agent_id: "bc-00000000-0000-4000-8000-000000000001",
    tarmac_run_id: "run-00000000-0000-4000-8000-000000000001",
    tarmac_cursor_url: "https://cursor.com/agents/bc-00000000-0000-4000-8000-000000000001",
    tarmac_branch: `tarmac/rest-probe-${suffix}`,
    tarmac_pr_url: "https://github.com/fiberplane/tarmac/pull/1",
    tarmac_pr_number: "1",
    tarmac_base_sha: "0000000000000000000000000000000000000000",
    tarmac_head_sha: "1111111111111111111111111111111111111111",
    tarmac_last_error: "redacted-rest-probe",
  };
};

const main = async (): Promise<void> => {
  if (process.env.TARMAC_FP_REST_E2E !== "1") {
    skip("set TARMAC_FP_REST_E2E=1 to run the FP REST/no-clone proof");
  }

  const missingEnv = REQUIRED_ENV.filter((name) => process.env[name] === undefined);
  if (missingEnv.length > 0) {
    fail(`Missing required REST env names: ${missingEnv.join(", ")}`);
  }

  const issueId = requiredEnvValue(
    "TARMAC_FP_REST_ISSUE_ID",
    "Set TARMAC_FP_REST_ISSUE_ID to a disposable issue before running this proof.",
  );

  const cwd = process.env.TARMAC_FP_REST_WORKDIR ?? DEFAULT_WORKDIR;
  await mkdir(cwd, {
    recursive: true,
  });

  writeOut(`Running FP REST/no-clone proof from ${cwd}`);
  writeOut(`Required env names present: FP_REMOTE, ${REQUIRED_ENV.join(", ")}`);

  const original = await readIssue(issueId, cwd);
  const probe = probeValues();
  const restore = restorePlan(original.properties);

  try {
    await runFp(["issue", "update", issueId, ...propertyArgs(probe)], cwd);
    const updated = await readIssue(issueId, cwd);
    const mismatches = TARMAC_PROPERTY_KEYS.filter((key) => updated.properties[key] !== probe[key]);

    if (mismatches.length > 0) {
      fail(`FP REST property round-trip failed for: ${mismatches.join(", ")}`);
    }

    writeOut(`PASS: FP REST round-tripped ${TARMAC_PROPERTY_KEYS.length} tarmac_* properties.`);
  } finally {
    await runFp(["issue", "update", issueId, ...restoreArgs(restore)], cwd);
    const restored = await readIssue(issueId, cwd);
    const restoreMismatches = verifyRestored(restore, restored);
    if (restoreMismatches.length > 0) {
      fail(`FP REST cleanup failed for: ${restoreMismatches.join(", ")}`);
    }
    writeOut("Restored or cleared original tarmac_* property values.");
  }
};

await main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  fail(`FP REST/no-clone proof failed: ${message}`);
});
