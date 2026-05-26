import { Schema } from "effect";

const REDACTED_TOKEN = "<redacted>";

export const FP_REST_ENV_NAMES = [
  "FP_REMOTE",
  "FP_TOKEN",
  "FP_WORKSPACE",
  "FP_PROJECT_ID",
  "FP_SERVER_URL",
  "FP_PROJECT_PREFIX",
] as const;

export type FpRestEnvName = (typeof FP_REST_ENV_NAMES)[number];

export type FpRestEnvValues = {
  readonly FP_REMOTE: string;
  readonly FP_TOKEN?: string;
  readonly FP_WORKSPACE: string;
  readonly FP_PROJECT_ID: string;
  readonly FP_SERVER_URL: string;
  readonly FP_PROJECT_PREFIX?: string;
};

const RemoteProjectJson = Schema.Struct({
  workspace: Schema.optional(Schema.String),
  workspaceSlug: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  serverUrl: Schema.optional(Schema.String),
  apiUrl: Schema.optional(Schema.String),
  prefix: Schema.optional(Schema.String),
  projectPrefix: Schema.optional(Schema.String),
});

type RemoteProjectJson = Schema.Schema.Type<typeof RemoteProjectJson>;

const firstNonEmpty = (...values: readonly (string | undefined)[]): string | undefined => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed !== "") {
      return trimmed;
    }
  }

  return undefined;
};

export const parseRemoteProjectJson = (raw: string): FpRestEnvValues => {
  const parsed = Schema.decodeUnknownSync(RemoteProjectJson)(JSON.parse(raw));
  const workspace = firstNonEmpty(parsed.workspace, parsed.workspaceSlug);
  const projectId = firstNonEmpty(parsed.projectId, parsed.id);
  const serverUrl = firstNonEmpty(parsed.serverUrl, parsed.apiUrl);
  const prefix = firstNonEmpty(parsed.prefix, parsed.projectPrefix);

  const missing: string[] = [];
  if (workspace === undefined) {
    missing.push("workspace");
  }
  if (projectId === undefined) {
    missing.push("projectId");
  }
  if (serverUrl === undefined) {
    missing.push("serverUrl");
  }

  if (missing.length > 0) {
    throw new Error(
      `fp project remote JSON is missing required fields: ${missing.join(", ")}. Run 'fp project remote' and 'fp project link' from the repo root.`,
    );
  }

  return {
    FP_REMOTE: "rest",
    FP_WORKSPACE: workspace!,
    FP_PROJECT_ID: projectId!,
    FP_SERVER_URL: serverUrl!,
    ...(prefix === undefined ? {} : { FP_PROJECT_PREFIX: prefix }),
  };
};

export type FormatRestEnvOptions = {
  readonly includeToken?: boolean;
  readonly tokenFromEnv?: string;
  readonly shell?: boolean;
};

export const formatRestEnv = (
  values: FpRestEnvValues,
  options: FormatRestEnvOptions = {},
): string => {
  const lines: string[] = [];
  const token = options.includeToken === true ? options.tokenFromEnv?.trim() : undefined;
  const tokenValue =
    token !== undefined && token !== ""
      ? token
      : options.includeToken === true
        ? ""
        : REDACTED_TOKEN;

  const entries: ReadonlyArray<readonly [FpRestEnvName, string | undefined]> = [
    ["FP_REMOTE", values.FP_REMOTE],
    ["FP_WORKSPACE", values.FP_WORKSPACE],
    ["FP_PROJECT_ID", values.FP_PROJECT_ID],
    ["FP_SERVER_URL", values.FP_SERVER_URL],
    ["FP_PROJECT_PREFIX", values.FP_PROJECT_PREFIX],
    ["FP_TOKEN", tokenValue],
  ];

  for (const [name, value] of entries) {
    if (value === undefined) {
      continue;
    }

    if (options.shell === true) {
      if (name === "FP_TOKEN" && tokenValue === REDACTED_TOKEN) {
        lines.push(`# ${name}: export manually after 'fp auth login' (never commit or log)`);
        continue;
      }

      lines.push(`export ${name}=${shellQuote(value)}`);
      continue;
    }

    lines.push(`${name}=${name === "FP_TOKEN" ? tokenValue : value}`);
  }

  return lines.join("\n");
};

const shellQuote = (value: string): string => {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", `'\\''`)}'`;
};

export const redactTokenInText = (text: string, token: string | undefined): string => {
  const trimmed = token?.trim();
  if (trimmed === undefined || trimmed === "") {
    return text;
  }

  return text.split(trimmed).join(REDACTED_TOKEN);
};
