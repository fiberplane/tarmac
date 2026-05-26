#!/usr/bin/env bun
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { formatRestEnv, parseRemoteProjectJson, redactTokenInText } from "./rest-env-from-remote";

const execFileAsync = promisify(execFile);

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

const hasFlag = (name: string): boolean => process.argv.includes(name);

const readRepoRoot = (): string => process.env.TARMAC_REPO_ROOT?.trim() || process.cwd();

const runFpProjectRemote = async (cwd: string): Promise<string> => {
  try {
    const result = await execFileAsync("fp", ["project", "remote", "--format", "json"], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    fail(
      `fp project remote failed in ${cwd}. Link the project with 'fp project link' and retry. ${message}`,
    );
    return "";
  }
};

const main = async (): Promise<void> => {
  const repoRoot = readRepoRoot();
  const includeToken = hasFlag("--include-token");
  const shell = hasFlag("--shell");

  if (includeToken) {
    writeErr(
      "WARNING: --include-token prints FP_TOKEN to stdout. Use only in a local shell, never in CI logs, issue comments, or shared terminals.",
    );
  }

  const raw = await runFpProjectRemote(repoRoot);
  const values = parseRemoteProjectJson(raw);
  const tokenFromEnv = process.env.FP_TOKEN;
  const output = formatRestEnv(values, {
    includeToken,
    ...(tokenFromEnv === undefined ? {} : { tokenFromEnv }),
    shell,
  });

  const safeOutput =
    includeToken && tokenFromEnv !== undefined ? output : redactTokenInText(output, tokenFromEnv);

  writeOut(safeOutput);

  if (!includeToken) {
    writeOut("");
    writeOut(
      "FP_TOKEN is redacted. Export it from your shell after fp auth login, or re-run with --include-token only on a trusted local machine.",
    );
  }
};

await main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  fail(message);
});
