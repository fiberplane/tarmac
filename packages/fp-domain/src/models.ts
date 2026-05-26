import { Schema } from "effect";

export const TarmacReadyValue = Schema.Literal("true", "false");
export type TarmacReadyValue = Schema.Schema.Type<typeof TarmacReadyValue>;

export const TarmacState = Schema.Literal("idle", "active", "end", "needs-attention");
export type TarmacState = Schema.Schema.Type<typeof TarmacState>;

export const TarmacTextProperty = Schema.String;
export type TarmacTextProperty = Schema.Schema.Type<typeof TarmacTextProperty>;

export const TarmacPropertyKey = Schema.Literal(
  "tarmac_ready",
  "tarmac_state",
  "tarmac_attempt",
  "tarmac_claim_id",
  "tarmac_agent_id",
  "tarmac_run_id",
  "tarmac_branch",
  "tarmac_pr_url",
  "tarmac_pr_number",
  "tarmac_base_sha",
  "tarmac_head_sha",
  "tarmac_last_error",
);
export type TarmacPropertyKey = Schema.Schema.Type<typeof TarmacPropertyKey>;

export const TARMAC_PROPERTY_KEYS: readonly TarmacPropertyKey[] = [
  "tarmac_ready",
  "tarmac_state",
  "tarmac_attempt",
  "tarmac_claim_id",
  "tarmac_agent_id",
  "tarmac_run_id",
  "tarmac_branch",
  "tarmac_pr_url",
  "tarmac_pr_number",
  "tarmac_base_sha",
  "tarmac_head_sha",
  "tarmac_last_error",
];

export type TarmacProperties = {
  readonly ready: TarmacReadyValue;
  readonly state: TarmacState;
  readonly attempt?: string;
  readonly claimId?: string;
  readonly agentId?: string;
  readonly runId?: string;
  readonly branch?: string;
  readonly prUrl?: string;
  readonly prNumber?: string;
  readonly baseSha?: string;
  readonly headSha?: string;
  readonly lastError?: string;
};

export type TarmacIssue = {
  readonly id: string;
  readonly displayId?: string;
  readonly status: string;
  readonly parent?: string;
  readonly dependencies: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
};

export type OpenIssueIndex = {
  readonly ids: ReadonlySet<string>;
  readonly childrenByParent: ReadonlyMap<string, readonly string[]>;
};

export type TarmacIssueUpdate = {
  readonly status?: string;
  readonly properties: Readonly<Partial<Record<TarmacPropertyKey, string>>>;
};
