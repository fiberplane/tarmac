import type { PromptRedactionConfig } from "@tarmac/worker-prompt";
import type { WorkerRepositoryContext } from "@tarmac/worker-prompt";

import type { CursorMode } from "./launch-config";
import {
  createRunSessionObserver,
  LocalRunStore,
  resolveStateRoot,
  type RunCommand,
  type RunSession,
} from "./local-state";
import { redactText } from "./local-state/redact";
import type { TarmacOrchestrator, WatchResult } from "./orchestrator";

export type PersistedRunOptions<T> = {
  readonly cwd: string;
  readonly command: RunCommand;
  readonly cursorMode: CursorMode;
  readonly repository: WorkerRepositoryContext;
  readonly runnerId: string;
  readonly redaction?: PromptRedactionConfig;
  readonly createOrchestrator: (
    observer: ReturnType<typeof createRunSessionObserver>,
  ) => Promise<TarmacOrchestrator>;
  readonly run: (orchestrator: TarmacOrchestrator) => Promise<T>;
  readonly summarize?: (result: T) => {
    readonly iterations?: number;
    readonly dispatchedCount?: number;
  };
};

export const runWithPersistedSession = async <T>(
  options: PersistedRunOptions<T>,
): Promise<{ readonly session: RunSession; readonly result: T }> => {
  const store = new LocalRunStore({
    stateRoot: resolveStateRoot(options.cwd),
    ...(options.redaction === undefined ? {} : { redaction: options.redaction }),
  });
  const session = store.beginRun({
    command: options.command,
    runnerId: options.runnerId,
    repository: {
      remoteUrl: options.repository.remoteUrl,
      baseBranch: options.repository.baseBranch,
      baseSha: options.repository.baseSha,
    },
    cursorMode: options.cursorMode,
  });

  await session.open();
  const observer = createRunSessionObserver(session);
  const orchestrator = await options.createOrchestrator(observer);

  try {
    const result = await options.run(orchestrator);
    await session.finish({
      status: "completed",
      ...(options.summarize === undefined ? {} : { summary: options.summarize(result) }),
    });
    return {
      session,
      result,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await session.finish({
      status: "failed",
      summary: {
        error: redactText(message, options.redaction),
      },
    });
    throw cause;
  }
};

export const summarizeWatchResult = (result: WatchResult) => ({
  iterations: result.iterations,
  dispatchedCount: result.dispatched.length,
});
