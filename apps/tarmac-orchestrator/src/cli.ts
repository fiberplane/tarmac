#!/usr/bin/env bun
import { createCursorSdkClient, createFakeCursorClient } from "@tarmac/cursor-client";

import { runWithPersistedSession, summarizeWatchResult } from "./cli-persistence";
import { readDispatchCapacityConfig } from "./dispatch-config";
import { CliUsageError } from "./errors";
import { FpCliClient } from "./fp-client";
import { buildCursorWorkerEnv, buildHostSecretRedaction, parseCursorMode } from "./launch-config";
import { LocalRunStore, resolveStateRoot } from "./local-state";
import type { OrchestratorObserver } from "./local-state/observer";
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
      messageText: "Usage: tarmac <scan|run-one|reconcile|watch|daemon|status> [options]",
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

const shouldPersistRuns = (command: string, flags: ReadonlyMap<string, string | true>): boolean => {
  if (hasFlag(flags, "no-persist")) {
    return false;
  }

  if (command === "watch" || command === "daemon") {
    return true;
  }

  return hasFlag(flags, "persist");
};

type OrchestratorBuildOptions = {
  readonly flags: ReadonlyMap<string, string | true>;
  readonly observer?: OrchestratorObserver;
};

const createOrchestrator = async (options: OrchestratorBuildOptions) => {
  const cursorMode = parseCursorMode(flagString(options.flags, "cursor"));
  if (cursorMode === undefined) {
    throw new CliUsageError({
      messageText: "--cursor must be fake or real",
    });
  }

  const cursorEnvVars = buildCursorWorkerEnv(cursorMode);
  const repository = await readRepositoryContext(process.cwd(), {
    requireLocalHeadAtRemote: cursorMode === "real",
  });
  const redaction = buildHostSecretRedaction();
  const capacity = readDispatchCapacityConfig(
    process.env,
    flagString(options.flags, "max-concurrent-runs"),
  );

  return {
    orchestrator: new TarmacOrchestrator({
      fpClient: new FpCliClient(process.cwd()),
      cursorClient: cursorMode === "real" ? createCursorSdkClient() : createFakeCursorClient(),
      repository,
      redaction,
      maxConcurrentRuns: capacity.maxConcurrentRuns,
      ...(options.observer === undefined ? {} : { observer: options.observer }),
      ...(cursorEnvVars === undefined ? {} : { cursorEnvVars }),
    }),
    cursorMode,
    redaction,
    repository,
  };
};

const runnerId = (): string => `tarmac-${process.pid}`;

const runPersisted = async <T>(
  command: string,
  flags: ReadonlyMap<string, string | true>,
  run: (orchestrator: TarmacOrchestrator) => Promise<T>,
  summarize?: (result: T) => { readonly iterations?: number; readonly dispatchedCount?: number },
): Promise<T> => {
  const built = await createOrchestrator({ flags });
  const { result } = await runWithPersistedSession({
    cwd: process.cwd(),
    command: command as "watch" | "daemon" | "scan" | "run-one" | "reconcile",
    cursorMode: built.cursorMode,
    repository: built.repository,
    runnerId: runnerId(),
    redaction: built.redaction,
    createOrchestrator: async (observer) => {
      const next = await createOrchestrator({
        flags,
        observer,
      });
      return next.orchestrator;
    },
    run,
    ...(summarize === undefined ? {} : { summarize }),
  });
  return result;
};

const runMaybePersisted = async <T>(
  command: string,
  flags: ReadonlyMap<string, string | true>,
  run: (orchestrator: TarmacOrchestrator) => Promise<T>,
  summarize?: (result: T) => { readonly iterations?: number; readonly dispatchedCount?: number },
): Promise<T> => {
  if (!shouldPersistRuns(command, flags)) {
    const built = await createOrchestrator({ flags });
    return run(built.orchestrator);
  }

  return runPersisted(command, flags, run, summarize);
};

export const main = async (argv: readonly string[] = process.argv.slice(2)): Promise<void> => {
  const parsed = parseArgs(argv);

  if (parsed.command === "status") {
    const limit = Number.parseInt(flagString(parsed.flags, "limit") ?? "10", 10);
    const eventsLimit = Number.parseInt(flagString(parsed.flags, "events") ?? "0", 10);
    const store = new LocalRunStore({
      stateRoot: resolveStateRoot(process.cwd()),
      redaction: buildHostSecretRedaction(),
    });
    const runs = await store.listRecentRuns(Number.isFinite(limit) ? limit : 10);
    const runsWithEvents =
      eventsLimit > 0
        ? await Promise.all(
            runs.map(async (run) => {
              const events = await store.readRunEvents(run.eventsPath, eventsLimit);
              return {
                ...run,
                events: events.events,
                corruptEventLineCount: events.corruptLineCount,
              };
            }),
          )
        : runs;

    writeJson({
      stateRoot: resolveStateRoot(process.cwd()),
      runs: runsWithEvents,
    });
    return;
  }

  if (parsed.command === "scan") {
    const scan = await runMaybePersisted(parsed.command, parsed.flags, (orchestrator) =>
      orchestrator.scan(),
    );
    writeJson({
      eligible: scan.eligible.map((issue) => issue.displayId ?? issue.id),
      ineligible: scan.ineligible.map((entry) => ({
        issue: entry.issue.displayId ?? entry.issue.id,
        reason: entry.reason.kind,
        ...(entry.reason.kind === "blocked-by-capacity"
          ? {
              activeRunCount: entry.reason.activeRunCount,
              maxConcurrentRuns: entry.reason.maxConcurrentRuns,
            }
          : {}),
        ...(entry.reason.kind === "blocked-by-dependency"
          ? { dependencyId: entry.reason.dependencyId }
          : {}),
        ...(entry.reason.kind === "blocked-by-open-child" ? { childId: entry.reason.childId } : {}),
      })),
      capacity: {
        activeRunCount: scan.activeRunCount,
        maxConcurrentRuns: scan.maxConcurrentRuns,
      },
      parentRollups: scan.parentRollups,
    });
    return;
  }

  if (parsed.command === "run-one") {
    const issueId = parsed.positionals[0];
    if (issueId === undefined) {
      throw new CliUsageError({
        messageText: "Usage: tarmac run-one <issue-id> [--cursor fake|real] [--persist]",
      });
    }

    const result = await runMaybePersisted(parsed.command, parsed.flags, (orchestrator) =>
      orchestrator.runOne(issueId),
    );
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
        messageText: "Usage: tarmac reconcile <issue-id> [--cursor fake|real] [--persist]",
      });
    }

    const result = await runMaybePersisted(parsed.command, parsed.flags, (orchestrator) =>
      orchestrator.reconcile(issueId),
    );
    writeJson({
      issue: result.issue.displayId ?? result.issue.id,
      status: result.cursorRun.status,
      branch: result.cursorRun.branch,
      prUrl: result.cursorRun.prUrl,
    });
    return;
  }

  const runWatchLoop = async (command: "watch" | "daemon") => {
    const pollIntervalSeconds = Number.parseFloat(flagString(parsed.flags, "poll-interval") ?? "5");
    const watchOptions = {
      pollIntervalMs: pollIntervalSeconds * 1_000,
      ...(hasFlag(parsed.flags, "once") ? { maxIterations: 1 } : {}),
    };
    const result = await runMaybePersisted(
      command,
      parsed.flags,
      (orchestrator) => orchestrator.watch(watchOptions),
      summarizeWatchResult,
    );
    writeJson({
      iterations: result.iterations,
      dispatched: result.dispatched.map(
        (dispatch) => dispatch.issue.displayId ?? dispatch.issue.id,
      ),
    });
  };

  if (parsed.command === "watch" || parsed.command === "daemon") {
    await runWatchLoop(parsed.command);
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
