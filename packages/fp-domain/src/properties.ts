import { Either, Schema } from "effect";

import {
  TarmacReadyValue,
  TarmacState,
  TarmacTextProperty,
  type TarmacProperties,
  type TarmacPropertyKey,
} from "./models";

export type DecodeFailure = {
  readonly key: TarmacPropertyKey;
  readonly value: unknown;
  readonly expected: string;
};

export type DecodeTarmacPropertiesResult =
  | {
      readonly kind: "valid";
      readonly properties: TarmacProperties;
    }
  | {
      readonly kind: "invalid";
      readonly failures: readonly DecodeFailure[];
    };

const decodeReady = (value: unknown): TarmacReadyValue | DecodeFailure => {
  const decoded = Schema.decodeUnknownEither(TarmacReadyValue)(value);
  return Either.match(decoded, {
    onLeft: () => ({
      key: "tarmac_ready",
      value,
      expected: '"true" or "false"',
    }),
    onRight: (ready) => ready,
  });
};

const decodeState = (value: unknown): TarmacState | DecodeFailure => {
  const decoded = Schema.decodeUnknownEither(TarmacState)(value);
  return Either.match(decoded, {
    onLeft: () => ({
      key: "tarmac_state",
      value,
      expected: '"idle", "active", "end", or "needs-attention"',
    }),
    onRight: (state) => state,
  });
};

const decodeText = (key: TarmacPropertyKey, value: unknown): string | DecodeFailure => {
  const decoded = Schema.decodeUnknownEither(TarmacTextProperty)(value);
  return Either.match(decoded, {
    onLeft: () => ({
      key,
      value,
      expected: "string",
    }),
    onRight: (text) => text,
  });
};

const isFailure = (value: unknown): value is DecodeFailure =>
  typeof value === "object" && value !== null && "expected" in value && "key" in value;

const setIfPresent = (
  output: Record<string, string>,
  source: Readonly<Record<string, unknown>>,
  sourceKey: TarmacPropertyKey,
  targetKey: string,
  failures: DecodeFailure[],
) => {
  const value = source[sourceKey];
  if (value === undefined) {
    return;
  }

  const decoded = decodeText(sourceKey, value);
  if (isFailure(decoded)) {
    failures.push(decoded);
    return;
  }

  output[targetKey] = decoded;
};

export const decodeTarmacProperties = (
  properties: Readonly<Record<string, unknown>>,
): DecodeTarmacPropertiesResult => {
  const failures: DecodeFailure[] = [];

  const readyValue = properties.tarmac_ready;
  let ready: TarmacReadyValue = "false";
  if (readyValue !== undefined) {
    const decoded = decodeReady(readyValue);
    if (isFailure(decoded)) {
      failures.push(decoded);
    } else {
      ready = decoded;
    }
  }

  const stateValue = properties.tarmac_state;
  let state: TarmacState = "idle";
  if (stateValue !== undefined) {
    const decoded = decodeState(stateValue);
    if (isFailure(decoded)) {
      failures.push(decoded);
    } else {
      state = decoded;
    }
  }

  const textProperties: Record<string, string> = {};
  setIfPresent(textProperties, properties, "tarmac_attempt", "attempt", failures);
  setIfPresent(textProperties, properties, "tarmac_claim_id", "claimId", failures);
  setIfPresent(textProperties, properties, "tarmac_agent_id", "agentId", failures);
  setIfPresent(textProperties, properties, "tarmac_run_id", "runId", failures);
  setIfPresent(textProperties, properties, "tarmac_cursor_url", "cursorUrl", failures);
  setIfPresent(textProperties, properties, "tarmac_branch", "branch", failures);
  setIfPresent(textProperties, properties, "tarmac_pr_url", "prUrl", failures);
  setIfPresent(textProperties, properties, "tarmac_pr_number", "prNumber", failures);
  setIfPresent(textProperties, properties, "tarmac_base_sha", "baseSha", failures);
  setIfPresent(textProperties, properties, "tarmac_head_sha", "headSha", failures);
  setIfPresent(textProperties, properties, "tarmac_last_error", "lastError", failures);

  if (failures.length > 0) {
    return {
      kind: "invalid",
      failures,
    };
  }

  return {
    kind: "valid",
    properties: {
      ready,
      state,
      ...textProperties,
    },
  };
};

export const encodeTarmacProperties = (
  properties: TarmacProperties,
): Readonly<Partial<Record<TarmacPropertyKey, string>>> => {
  const encoded: Partial<Record<TarmacPropertyKey, string>> = {
    tarmac_ready: properties.ready,
    tarmac_state: properties.state,
  };

  if (properties.attempt !== undefined) {
    encoded.tarmac_attempt = properties.attempt;
  }
  if (properties.claimId !== undefined) {
    encoded.tarmac_claim_id = properties.claimId;
  }
  if (properties.agentId !== undefined) {
    encoded.tarmac_agent_id = properties.agentId;
  }
  if (properties.runId !== undefined) {
    encoded.tarmac_run_id = properties.runId;
  }
  if (properties.cursorUrl !== undefined) {
    encoded.tarmac_cursor_url = properties.cursorUrl;
  }
  if (properties.branch !== undefined) {
    encoded.tarmac_branch = properties.branch;
  }
  if (properties.prUrl !== undefined) {
    encoded.tarmac_pr_url = properties.prUrl;
  }
  if (properties.prNumber !== undefined) {
    encoded.tarmac_pr_number = properties.prNumber;
  }
  if (properties.baseSha !== undefined) {
    encoded.tarmac_base_sha = properties.baseSha;
  }
  if (properties.headSha !== undefined) {
    encoded.tarmac_head_sha = properties.headSha;
  }
  if (properties.lastError !== undefined) {
    encoded.tarmac_last_error = properties.lastError;
  }

  return encoded;
};
