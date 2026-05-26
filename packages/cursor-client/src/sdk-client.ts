import type { AgentOptions, GetRunOptions, Run, SDKAgent } from "@cursor/sdk";

import { MissingCursorApiKeyError } from "./errors";
import { normalizeRun } from "./normalize";
import type {
  CursorClient,
  CursorDispatchRequest,
  CursorRunReference,
  CursorRunSnapshot,
} from "./types";

export type CursorAgentNamespace = {
  readonly create: (options: AgentOptions) => Promise<SDKAgent>;
  readonly getRun: (
    runId: string,
    options: Extract<GetRunOptions, { runtime: "cloud" }>,
  ) => Promise<Run>;
};

export type CursorSdkClientOptions = {
  readonly apiKey?: string;
  readonly agentNamespace?: CursorAgentNamespace;
};

const resolveApiKey = (apiKey: string | undefined): string => {
  const resolved = apiKey ?? process.env.CURSOR_API_KEY;
  if (resolved === undefined || resolved.trim() === "") {
    throw new MissingCursorApiKeyError();
  }

  return resolved;
};

const loadDefaultAgentNamespace = async (): Promise<CursorAgentNamespace> => {
  // ast-grep-ignore: no-dynamic-import
  const sdk = await import("@cursor/sdk");
  return sdk.Agent;
};

export class CursorSdkClient implements CursorClient {
  readonly #apiKey: string | undefined;
  readonly #agentNamespace: CursorAgentNamespace | undefined;

  constructor(options: CursorSdkClientOptions = {}) {
    this.#apiKey = options.apiKey;
    this.#agentNamespace = options.agentNamespace;
  }

  async dispatch(request: CursorDispatchRequest): Promise<CursorRunSnapshot> {
    const apiKey = resolveApiKey(request.apiKey ?? this.#apiKey);
    const agentNamespace = await this.#resolveAgentNamespace();
    const agent = await agentNamespace.create({
      apiKey,
      name: request.name,
      ...(request.modelId === undefined ? {} : { model: { id: request.modelId } }),
      cloud: {
        repos: [request.repository],
        autoCreatePR: request.autoCreatePR ?? true,
        ...(request.envVars === undefined ? {} : { envVars: { ...request.envVars } }),
      },
    });

    const run = await agent.send(
      request.prompt,
      request.idempotencyKey === undefined
        ? undefined
        : {
            idempotencyKey: request.idempotencyKey,
          },
    );

    return normalizeRun(run);
  }

  async getRun(reference: CursorRunReference): Promise<CursorRunSnapshot> {
    const apiKey = resolveApiKey(reference.apiKey ?? this.#apiKey);
    const agentNamespace = await this.#resolveAgentNamespace();
    const run = await agentNamespace.getRun(reference.runId, {
      runtime: "cloud",
      agentId: reference.agentId,
      apiKey,
    });

    return normalizeRun(run);
  }

  async #resolveAgentNamespace(): Promise<CursorAgentNamespace> {
    return this.#agentNamespace ?? loadDefaultAgentNamespace();
  }
}

export const createCursorSdkClient = (options: CursorSdkClientOptions = {}): CursorSdkClient =>
  new CursorSdkClient(options);
