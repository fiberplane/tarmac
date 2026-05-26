#!/usr/bin/env bun
/**
 * Fetch PR CI checks and extract relevant failure snippets.
 *
 * Usage:
 *   bun run fetch-pr-checks.ts [--pr PR_NUMBER]
 *
 * If --pr is not specified, uses the PR for the current branch.
 *
 * Output: JSON to stdout with structured check data.
 */

import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGh } from "./lib/gh.ts";

const LOG_CACHE_DIR = join(tmpdir(), "monitor-pr-cache");
const REVIEW_BOT_CHECK_PATTERNS = [/cursor/i, /bugbot/i, /copilot/i, /codex/i, /claude/i, /codeql/i];

interface PrInfo {
  number: number;
  url: string;
  headRefName: string;
  baseRefName: string;
}

function getPrInfo(prNumber?: number): PrInfo | null {
  const args = ["pr", "view", "--json", "number,url,headRefName,baseRefName"];
  if (prNumber) args.splice(2, 0, String(prNumber));
  return runGh(args) as PrInfo | null;
}

interface RawCheck {
  name: string;
  bucket: string;
  link: string;
  state?: string;
  workflow?: string;
}

function getChecks(prNumber?: number, required = false): RawCheck[] {
  const args = ["gh", "pr", "checks"];
  if (prNumber) args.push(String(prNumber));
  if (required) args.push("--required");
  args.push("--json", "name,bucket,link,state,workflow");

  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (stderr) console.error(`Error running gh pr checks: ${stderr}`);
    return [];
  }
  const stdout = result.stdout.toString().trim();
  if (!stdout) return [];

  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed as RawCheck[]) : [];
  } catch {
    return [];
  }
}

interface WorkflowRun {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string;
  headSha: string;
}

function getFailedRuns(branch: string): WorkflowRun[] {
  const result = runGh([
    "run",
    "list",
    "--branch",
    branch,
    "--status",
    "failure",
    "--limit",
    "5",
    "--json",
    "databaseId,name,status,conclusion,headSha",
  ]);
  return Array.isArray(result) ? (result as WorkflowRun[]) : [];
}

// ---------------------------------------------------------------------------
// Failure snippet extraction
// ---------------------------------------------------------------------------

const FAILURE_PATTERNS = [
  /error[:\s]/i,
  /failed[:\s]/i,
  /failure[:\s]/i,
  /traceback/i,
  /exception/i,
  /assert(ion)?.*failed/i,
  /FAILED/,
  /panic:/,
  /fatal:/i,
  /npm ERR!/,
  /yarn error/i,
  /ModuleNotFoundError/,
  /ImportError/,
  /SyntaxError/,
  /TypeError/,
  /ValueError/,
  /KeyError/,
  /AttributeError/,
  /NameError/,
  /IndentationError/,
  /===.*FAILURES.*===/,
  /___.*___/, // pytest failure separators
];

function extractFailureSnippet(logText: string, maxLines = 50): string {
  const lines = logText.split("\n");

  const failureIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (FAILURE_PATTERNS.some((p) => p.test(lines[i]))) {
      failureIndices.push(i);
    }
  }

  if (failureIndices.length === 0) {
    // No clear failure point — return last N lines
    return lines.slice(-maxLines).join("\n");
  }

  // Extract context around first failure point
  const firstFailure = failureIndices[0];
  const start = Math.max(0, firstFailure - 5);
  const end = Math.min(lines.length, firstFailure + maxLines - 5);

  const snippetLines = lines.slice(start, end);

  const remaining = failureIndices.filter((i) => i >= end);
  if (remaining.length > 0) {
    snippetLines.push(`\n... (${remaining.length} more error(s) follow)`);
  }

  return snippetLines.join("\n");
}

function getCachedSnippet(runId: number): string | null {
  const path = join(LOG_CACHE_DIR, `snippet-${runId}.txt`);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function writeCachedSnippet(runId: number, snippet: string): void {
  try {
    if (!existsSync(LOG_CACHE_DIR)) mkdirSync(LOG_CACHE_DIR, { recursive: true });
    writeFileSync(join(LOG_CACHE_DIR, `snippet-${runId}.txt`), snippet);
  } catch {
    // best-effort cache; ignore failures
  }
}

function getRunLogs(runId: number): string | null {
  try {
    const result = Bun.spawnSync(
      ["gh", "run", "view", String(runId), "--log-failed"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = result.stdout.toString();
    return stdout || result.stderr.toString() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      pr: { type: "string", short: "p" },
    },
    allowPositionals: false,
  });

  const prNumber = values.pr ? Number(values.pr) : undefined;

  // Get PR info
  const prInfo = getPrInfo(prNumber);
  if (!prInfo) {
    console.log(JSON.stringify({ error: "No PR found for current branch" }));
    process.exit(1);
  }

  const branch = prInfo.headRefName;

  // Get checks. Required checks are the merge-blocking CI gate; all checks are
  // still reported so neutral/info checks like Cursor Bugbot remain visible.
  const checks = getChecks(prInfo.number);
  const requiredChecks = getChecks(prInfo.number, true);

  // Process checks and add failure snippets
  let failedRuns: WorkflowRun[] | undefined;

  const processChecks = (rawChecks: RawCheck[]) => rawChecks.map((check) => {
    const processed: Record<string, unknown> = {
      name: check.name,
      status: check.bucket,
      link: check.link,
    };
    if (check.state) processed.state = check.state;
    if (check.workflow) processed.workflow = check.workflow;

    if (processed.status === "fail") {
      failedRuns ??= getFailedRuns(branch);

      const matchingRun = failedRuns.find((r) =>
        r.name.includes(check.name),
      );

      if (matchingRun) {
        const runId = matchingRun.databaseId;
        let snippet = getCachedSnippet(runId);
        if (!snippet) {
          const logs = getRunLogs(runId);
          if (logs) {
            snippet = extractFailureSnippet(logs);
            writeCachedSnippet(runId, snippet);
          }
        }
        if (snippet) {
          processed.log_snippet = snippet;
          processed.run_id = runId;
        }
      }
    }

    return processed;
  });

  const processedChecks = processChecks(checks);
  const processedRequiredChecks = processChecks(requiredChecks);
  const countStatus = (items: Array<Record<string, unknown>>, status: string) =>
    items.filter((c) => c.status === status).length;
  const countNonPassTerminal = (items: Array<Record<string, unknown>>) =>
    items.filter((c) => c.status !== "pass" && c.status !== "pending").length;
  const gatedChecks =
    processedRequiredChecks.length > 0 ? processedRequiredChecks : processedChecks;
  const reviewBotChecks = processedChecks.filter((check) => {
    const name = String(check.name ?? "");
    const workflow = String(check.workflow ?? "");
    return REVIEW_BOT_CHECK_PATTERNS.some((pattern) => pattern.test(name) || pattern.test(workflow));
  });
  const pendingReviewBotChecks = reviewBotChecks.filter((check) => check.status === "pending");
  const gatedPending = countStatus(gatedChecks, "pending");
  const gatedNonPass = countNonPassTerminal(gatedChecks);
  const gatedMode = processedRequiredChecks.length > 0 ? "required" : "all";

  const output = {
    pr: {
      number: prInfo.number,
      url: prInfo.url ?? "",
      branch,
      base: prInfo.baseRefName ?? "",
    },
    summary: {
      total: processedChecks.length,
      passed: countStatus(processedChecks, "pass"),
      failed: countStatus(processedChecks, "fail"),
      pending: countStatus(processedChecks, "pending"),
      skipped: processedChecks.filter(
        (c) => c.status === "skipping" || c.status === "cancel",
      ).length,
      required_total: processedRequiredChecks.length,
      required_passed: countStatus(processedRequiredChecks, "pass"),
      required_failed: countStatus(processedRequiredChecks, "fail"),
      required_pending: countStatus(processedRequiredChecks, "pending"),
      required_nonpass_terminal: countNonPassTerminal(processedRequiredChecks),
      gated_mode: gatedMode,
      gated_total: gatedChecks.length,
      gated_passed: countStatus(gatedChecks, "pass"),
      gated_failed: countStatus(gatedChecks, "fail"),
      gated_pending: gatedPending,
      gated_nonpass_terminal: gatedNonPass,
      pending_review_bot_checks: pendingReviewBotChecks.length,
      gated_blocking: gatedPending + gatedNonPass + pendingReviewBotChecks.length > 0,
    },
    checks: processedChecks,
    required_checks: processedRequiredChecks,
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
