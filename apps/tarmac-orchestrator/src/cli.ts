#!/usr/bin/env bun
import { createCursorSdkClient, createFakeCursorClient } from "@tarmac/cursor-client";

import { CliUsageError } from "./errors";
import { FpCliClient } from "./fp-client";
import { buildCursorWorkerEnv, buildHostSecretRedaction, parseCursorMode } from "./launch-config";
import { TarmacOrchestrator } from "./orchestrator";
import { readRepositoryContext } from "./repository";

type ParsedArgs = {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string | true>;
};

const parseArgs = (argv: readonly string[]): ParsedArgs => {
  const [command, ...rest] = argv;
  if (command === undefined) {
    throw new CliUsageError({
      messageText: "Usage: tarmac <scan|run-one|reconcile|watch> [options]",
    });
  }

  const positionals: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === undefined) {
      continue;
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, next);
    index += 1;
  }

  return {
    command,
    positionals,
    flags,
  };
};

const flagString = (flags: ReadonlyMap<string, string | true>, key: string): string | undefined => {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
};

const hasFlag = (flags: ReadonlyMap<string, string | true>, key: string): boolean => flags.has(key);

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const createOrchestrator = async (flags: ReadonlyMap<string, string | true>) => {
  const cursorMode = parseCursorMode(flagString(flags, "cursor"));
  if (cursorMode === undefined) {
    throw new CliUsageError({
      messageText: "--cursor must be fake or real",
    });
  }

  const cursorEnvVars = buildCursorWorkerEnv(cursorMode);

  return new TarmacOrchestrator({
    fpClient: new FpCliClient(process.cwd()),
    cursorClient: cursorMode === "real" ? createCursorSdkClient() : createFakeCursorClient(),
    repository: await readRepositoryContext(process.cwd(), {
      requireLocalHeadAtRemote: cursorMode === "real",
    }),
    redaction: buildHostSecretRedaction(),
    ...(cursorEnvVars === undefined ? {} : { cursorEnvVars }),
  });
};

export const main = async (argv: readonly string[] = process.argv.slice(2)): Promise<void> => {
  const parsed = parseArgs(argv);

  if (parsed.command === "scan") {
    const orchestrator = await createOrchestrator(parsed.flags);
    const scan = await orchestrator.scan();
    writeJson({
      eligible: scan.eligible.map((issue) => issue.displayId ?? issue.id),
      ineligible: scan.ineligible.map((entry) => ({
        issue: entry.issue.displayId ?? entry.issue.id,
        reason: entry.reason.kind,
      })),
    });
    return;
  }

  if (parsed.command === "run-one") {
    const issueId = parsed.positionals[0];
    if (issueId === undefined) {
      throw new CliUsageError({
        messageText: "Usage: tarmac run-one <issue-id> [--cursor fake|real]",
      });
    }

    const orchestrator = await createOrchestrator(parsed.flags);
    const result = await orchestrator.runOne(issueId);
    writeJson({
      issue: result.issue.displayId ?? result.issue.id,
      agentId: result.cursorRun.agentId,
      runId: result.cursorRun.runId,
      branch: result.cursorRun.branch,
      prUrl: result.cursorRun.prUrl,
    });
    return;
  }

  if (parsed.command === "reconcile") {
    const issueId = parsed.positionals[0];
    if (issueId === undefined) {
      throw new CliUsageError({
        messageText: "Usage: tarmac reconcile <issue-id> [--cursor fake|real]",
      });
    }

    const orchestrator = await createOrchestrator(parsed.flags);
    const result = await orchestrator.reconcile(issueId);
    writeJson({
      issue: result.issue.displayId ?? result.issue.id,
      status: result.cursorRun.status,
      branch: result.cursorRun.branch,
      prUrl: result.cursorRun.prUrl,
    });
    return;
  }

  if (parsed.command === "watch") {
    const orchestrator = await createOrchestrator(parsed.flags);
    const pollIntervalSeconds = Number.parseFloat(flagString(parsed.flags, "poll-interval") ?? "5");
    const watchOptions = {
      pollIntervalMs: pollIntervalSeconds * 1_000,
      ...(hasFlag(parsed.flags, "once") ? { maxIterations: 1 } : {}),
    };
    const result = await orchestrator.watch(watchOptions);
    writeJson({
      iterations: result.iterations,
      dispatched: result.dispatched.map(
        (dispatch) => dispatch.issue.displayId ?? dispatch.issue.id,
      ),
    });
    return;
  }

  throw new CliUsageError({
    messageText: `Unknown tarmac command: ${parsed.command}`,
  });
};

if (import.meta.main) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
