import { UnknownFakeCursorRunError } from "./errors";
import type {
  CursorClient,
  CursorDispatchRequest,
  CursorRunReference,
  CursorRunSnapshot,
} from "./types";

export type FakeCursorClientOptions = {
  readonly defaultBranch?: string;
  readonly prBaseUrl?: string;
};

const uuidSuffix = (index: number): string => index.toString().padStart(12, "0");

const fakeAgentId = (index: number): string => `bc-00000000-0000-4000-8000-${uuidSuffix(index)}`;

const fakeRunId = (index: number): string => `run-00000000-0000-4000-8000-${uuidSuffix(index)}`;

const inferPullUrl = (repoUrl: string, index: number): string => {
  const normalized = repoUrl.replace(/\.git$/, "");
  return `${normalized}/pull/${index}`;
};

export class FakeCursorClient implements CursorClient {
  readonly #runs = new Map<string, CursorRunSnapshot>();
  #nextRunIndex = 1;

  constructor(private readonly options: FakeCursorClientOptions = {}) {}

  get runs(): readonly CursorRunSnapshot[] {
    return Array.from(this.#runs.values());
  }

  async dispatch(request: CursorDispatchRequest): Promise<CursorRunSnapshot> {
    const index = this.#nextRunIndex;
    this.#nextRunIndex += 1;

    const branch = request.repository.startingRef ?? this.options.defaultBranch ?? "main";
    const prUrl =
      this.options.prBaseUrl === undefined
        ? inferPullUrl(request.repository.url, index)
        : `${this.options.prBaseUrl.replace(/\/$/, "")}/${index}`;

    const snapshot: CursorRunSnapshot = {
      agentId: fakeAgentId(index),
      runId: fakeRunId(index),
      status: "finished",
      result: `fake cursor run for ${request.name}`,
      repoUrl: request.repository.url,
      branch,
      prUrl,
      branches: [
        {
          repoUrl: request.repository.url,
          branch,
          prUrl,
        },
      ],
    };

    this.#runs.set(snapshot.runId, snapshot);
    return snapshot;
  }

  async getRun(reference: CursorRunReference): Promise<CursorRunSnapshot> {
    const snapshot = this.#runs.get(reference.runId);
    if (snapshot === undefined || snapshot.agentId !== reference.agentId) {
      throw new UnknownFakeCursorRunError({
        agentId: reference.agentId,
        runId: reference.runId,
      });
    }

    return snapshot;
  }
}

export const createFakeCursorClient = (options?: FakeCursorClientOptions): FakeCursorClient =>
  new FakeCursorClient(options);
