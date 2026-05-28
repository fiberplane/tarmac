/**
 * Cursor Cloud Agent Extension
 *
 * Delegates FP issue work to Cursor's cloud agent API.
 *
 * The issue property stores only the visible status string. Durable agent
 * metadata lives in `.fp/cursor-agents.json` so the extension can resume
 * polling after a desktop extension-host reload.
 */

import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ExtensionComment,
  ExtensionInit,
  ExtensionIssue,
  FpExtensionContext,
} from "@fiberplane/extensions";

const PROPERTY_KEY = "cursor-agent";
const STORE_FILE = path.join(".fp", "cursor-agents.json");
const STAGE_PROPERTY_KEY = "cursor-agent-stage";
const HEALTH_PROPERTY_KEY = "cursor-agent-health";
const LAST_UPDATE_PROPERTY_KEY = "cursor-agent-last-update";
const PR_PROPERTY_KEY = "cursor-agent-pr";
const CURSOR_API_BASE = "https://api.cursor.com";
const POLL_INTERVAL_MS = 30_000;
const POLL_BACKOFF_MAX_MS = 5 * 60_000;
const MAX_PROJECT_GUIDELINES_CHARS = 20_000;
const PROGRESS_MIN_MESSAGE_CHARS = 12;
const PROGRESS_MAX_MESSAGE_CHARS = 1_200;
const PROGRESS_MAX_COMMENT_CHARS = 3_500;

type CursorAgentStatus = "creating" | "running" | "finished" | "stopped" | "error" | "expired";
type CursorAgentStage =
  | "queued"
  | "working"
  | "pr-opened"
  | "finished"
  | "stopped"
  | "error"
  | "expired";
type CursorAgentHealth = "ok" | "degraded" | "stale";

interface CursorAgentRecord {
  readonly issueId: string;
  readonly agentId: string;
  readonly runId?: string;
  readonly status: CursorAgentStatus;
  readonly branch?: string;
  readonly prUrl?: string;
  readonly agentUrl?: string;
  readonly summary?: string;
  readonly launchCommentPostedAt?: string;
  readonly prCommentPostedAt?: string;
  readonly summaryPostedAt?: string;
  readonly postedConversationMessageIds?: readonly string[];
  readonly lastConversationMessageId?: string;
  readonly lastProgressText?: string;
  readonly lastStatusPollAt?: string;
  readonly lastConversationPollAt?: string;
  readonly lastSuccessfulPollAt?: string;
  readonly pollFailureCount?: number;
  readonly lastPollError?: string;
  readonly followUpCommentIds?: readonly string[];
  readonly followUpSentAt?: string;
  readonly error?: string;
  readonly launchedAt: string;
  readonly updatedAt: string;
  readonly finishedAt?: string;
}

interface GitSource {
  readonly repository: string;
  readonly ref: string;
}

interface CursorApiSnapshot {
  readonly agentId?: string;
  readonly runId?: string;
  readonly status?: CursorAgentStatus;
  readonly branch?: string;
  readonly prUrl?: string;
  readonly agentUrl?: string;
  readonly summary?: string;
  readonly error?: string;
}

interface CursorConversationMessage {
  readonly id: string;
  readonly type: string;
  readonly text: string;
  readonly createdAt?: string;
}

interface ProgressComment {
  readonly content: string;
  readonly messageIds: readonly string[];
}

const activePollers = new Map<string, ReturnType<typeof setTimeout>>();
const issueQueues = new Map<string, Promise<void>>();
const agentQueues = new Map<string, Promise<void>>();
const storeQueues = new Map<string, Promise<void>>();

const terminalStatuses = new Set<CursorAgentStatus>(["finished", "stopped", "error", "expired"]);

const init: ExtensionInit = async (fp: FpExtensionContext) => {
  await fp.issues.registerProperty(PROPERTY_KEY, {
    label: "Cursor Agent",
    icon: "box",
    display: fp.ui.properties.select(
      fp.ui.properties.option("creating", { label: "Creating", icon: "clock", color: "blue" }),
      fp.ui.properties.option("running", {
        label: "Running",
        icon: "loader-circle",
        color: "yellow",
      }),
      fp.ui.properties.option("finished", {
        label: "Finished",
        icon: "circle-check",
        color: "success",
      }),
      fp.ui.properties.option("stopped", { label: "Stopped", icon: "square", color: "neutral" }),
      fp.ui.properties.option("error", {
        label: "Error",
        icon: "triangle-alert",
        color: "destructive",
      }),
      fp.ui.properties.option("expired", { label: "Expired", icon: "timer-off", color: "warning" }),
    ),
  });

  await fp.issues.registerProperty(STAGE_PROPERTY_KEY, {
    label: "Cursor Stage",
    icon: "rocket",
    display: fp.ui.properties.select(
      fp.ui.properties.option("queued", { label: "Queued", icon: "list-start", color: "blue" }),
      fp.ui.properties.option("working", { label: "Working", icon: "hammer", color: "yellow" }),
      fp.ui.properties.option("pr-opened", {
        label: "PR Opened",
        icon: "git-pull-request",
        color: "purple",
      }),
      fp.ui.properties.option("finished", {
        label: "Finished",
        icon: "badge-check",
        color: "success",
      }),
      fp.ui.properties.option("stopped", { label: "Stopped", icon: "pause", color: "neutral" }),
      fp.ui.properties.option("error", {
        label: "Error",
        icon: "triangle-alert",
        color: "destructive",
      }),
      fp.ui.properties.option("expired", { label: "Expired", icon: "timer-off", color: "warning" }),
    ),
  });

  await fp.issues.registerProperty(HEALTH_PROPERTY_KEY, {
    label: "Cursor Polling",
    icon: "wifi",
    display: fp.ui.properties.select(
      fp.ui.properties.option("ok", { label: "OK", icon: "wifi", color: "success" }),
      fp.ui.properties.option("degraded", {
        label: "Degraded",
        icon: "wifi-low",
        color: "warning",
      }),
      fp.ui.properties.option("stale", {
        label: "Stale",
        icon: "wifi-off",
        color: "destructive",
      }),
    ),
  });

  await fp.issues.registerProperty(LAST_UPDATE_PROPERTY_KEY, {
    label: "Cursor Last Update",
    icon: "message-square",
    display: fp.ui.properties.text(),
  });

  await fp.issues.registerProperty(PR_PROPERTY_KEY, {
    label: "Cursor PR",
    icon: "git-pull-request",
    display: fp.ui.properties.text(),
  });

  await fp.ui.registerAction({
    id: "cursor.launch",
    label: "Send to Cursor Agent",
    icon: "sparkles",
    keywords: ["cursor", "agent", "ai", "code"],
    when: async (ctx: Record<string, unknown>) => {
      const issue = getIssueFromContext(ctx);
      if (!issue) {
        return false;
      }
      const record = await findRecord(fp.projectDir, issue.id);
      return !record || terminalStatuses.has(record.status);
    },
    onExecute: async (ctx: Record<string, unknown>) => {
      const issue = getIssueFromContext(ctx);
      if (!issue) {
        return;
      }
      await launchAgent(fp, issue);
    },
  });

  await fp.ui.registerAction({
    id: "cursor.refresh",
    label: "Refresh Cursor Agent",
    icon: "refresh-cw",
    keywords: ["cursor", "agent", "refresh"],
    when: async (ctx: Record<string, unknown>) => {
      const issue = getIssueFromContext(ctx);
      if (!issue) {
        return false;
      }
      const record = await findRecord(fp.projectDir, issue.id);
      return record !== null;
    },
    onExecute: async (ctx: Record<string, unknown>) => {
      const issue = getIssueFromContext(ctx);
      if (!issue) {
        return;
      }
      const record = await findRecord(fp.projectDir, issue.id);
      if (!record) {
        return;
      }
      await refreshAgent(fp, record.agentId, { notifyTerminal: true });
    },
  });

  await fp.ui.registerAction({
    id: "cursor.stop",
    label: "Stop Cursor Agent",
    icon: "square",
    keywords: ["cursor", "stop", "cancel"],
    when: async (ctx: Record<string, unknown>) => {
      const issue = getIssueFromContext(ctx);
      if (!issue) {
        return false;
      }
      const record = await findRecord(fp.projectDir, issue.id);
      return record?.status === "creating" || record?.status === "running";
    },
    onExecute: async (ctx: Record<string, unknown>) => {
      const issue = getIssueFromContext(ctx);
      if (!issue) {
        return;
      }
      await stopAgent(fp, issue);
    },
  });

  await fp.ui.registerAction({
    id: "cursor.follow-up",
    label: "Send Cursor Follow-up",
    icon: "send",
    keywords: ["cursor", "agent", "followup", "follow-up", "message"],
    when: async (ctx: Record<string, unknown>) => {
      const issue = getIssueFromContext(ctx);
      if (!issue) {
        return false;
      }
      const record = await findRecord(fp.projectDir, issue.id);
      return Boolean(record && !terminalStatuses.has(record.status));
    },
    onExecute: async (ctx: Record<string, unknown>) => {
      const issue = getIssueFromContext(ctx);
      if (!issue) {
        return;
      }
      await sendLatestFollowUp(fp, issue);
    },
  });

  await fp.ui.registerAction({
    id: "cursor.show-url",
    label: "Show Cursor Agent URL",
    icon: "external-link",
    keywords: ["cursor", "open", "dashboard", "url"],
    when: async (ctx: Record<string, unknown>) => {
      const issue = getIssueFromContext(ctx);
      if (!issue) {
        return false;
      }
      const record = await findRecord(fp.projectDir, issue.id);
      return Boolean(record?.agentUrl);
    },
    onExecute: async (ctx: Record<string, unknown>) => {
      const issue = getIssueFromContext(ctx);
      if (!issue) {
        return;
      }
      const record = await findRecord(fp.projectDir, issue.id);
      if (!record?.agentUrl) {
        return;
      }
      await fp.ui.notify(record.agentUrl, { title: "Cursor Agent URL" });
      fp.log.info(`Cursor agent URL: ${record.agentUrl}`);
    },
  });

  await resumeActiveAgents(fp);
  fp.log.info("[cursor-agent] ready");
};

export default init;

async function launchAgent(fp: FpExtensionContext, issue: ExtensionIssue): Promise<void> {
  await withIssueLock(issue.id, () => launchAgentLocked(fp, issue));
}

async function launchAgentLocked(fp: FpExtensionContext, issue: ExtensionIssue): Promise<void> {
  const existing = await findRecord(fp.projectDir, issue.id);
  if (existing && !terminalStatuses.has(existing.status)) {
    startPolling(fp, existing.agentId);
    await fp.ui.notify("Cursor agent is already running for this issue.", {
      kind: "info",
      title: "Cursor",
    });
    return;
  }

  const apiKey = await resolveApiKey(fp);
  if (!apiKey) {
    await fp.ui.notify("Cursor API key not configured. Set it in Extensions settings.", {
      kind: "error",
      title: "Cursor",
    });
    return;
  }

  let source: GitSource;
  try {
    source = await getGitSource(fp.projectDir);
  } catch (err) {
    await fp.ui.notify(errorMessage(err), { kind: "error", title: "Cursor" });
    return;
  }

  const fullIssue = (await fp.issues.get(issue.id)) ?? issue;
  const prompt = await buildPrompt(fp, fullIssue);
  const branchName = buildBranchName(fullIssue);
  const autoCreatePr = fp.config.get<boolean>("auto-create-pr", true);
  const previousStatus = fullIssue.status;

  await fp.issues.update(issue.id, {
    status: "in-progress",
    properties: { [PROPERTY_KEY]: "creating" },
  });

  let res: Response;
  try {
    res = await cursorFetch(fp, apiKey, getLaunchPath(fp), {
      method: "POST",
      body: JSON.stringify({
        prompt: { text: prompt },
        source: {
          repository: source.repository,
          ref: source.ref,
        },
        target: {
          branchName,
          autoCreatePr,
          openAsCursorGithubApp: false,
          skipReviewerRequest: false,
        },
      }),
    });
  } catch (err) {
    await fp.issues.update(issue.id, {
      status: previousStatus,
      properties: { [PROPERTY_KEY]: "error" },
    });
    await fp.ui.notify(`Failed to reach Cursor API: ${errorMessage(err)}`, {
      kind: "error",
      title: "Cursor",
    });
    return;
  }

  if (!res.ok) {
    const body = await safeResponseText(res);
    await fp.issues.update(issue.id, {
      status: previousStatus,
      properties: { [PROPERTY_KEY]: "error" },
    });
    await fp.ui.notify(`Failed to launch Cursor agent (${res.status}): ${body}`, {
      kind: "error",
      title: "Cursor",
    });
    return;
  }

  const snapshot = extractApiSnapshot(await res.json());
  if (!snapshot.agentId) {
    await fp.issues.update(issue.id, {
      status: previousStatus,
      properties: { [PROPERTY_KEY]: "error" },
    });
    await fp.ui.notify("Cursor launch response did not include an agent ID.", {
      kind: "error",
      title: "Cursor",
    });
    return;
  }

  const now = new Date().toISOString();
  const record: CursorAgentRecord = {
    issueId: issue.id,
    agentId: snapshot.agentId,
    runId: snapshot.runId,
    status: snapshot.status ?? "running",
    branch: snapshot.branch ?? branchName,
    prUrl: snapshot.prUrl,
    agentUrl: snapshot.agentUrl ?? buildAgentUrl(snapshot.agentId),
    summary: snapshot.summary,
    error: snapshot.error,
    launchedAt: now,
    updatedAt: now,
    ...(snapshot.status && terminalStatuses.has(snapshot.status) ? { finishedAt: now } : {}),
  };

  const storedRecord = await ensureLaunchComment(fp, record);
  await upsertRecord(fp.projectDir, storedRecord);
  await syncIssueProperties(fp, storedRecord);
  await fp.ui.notify(`Cursor agent launched for ${fullIssue.title}`, {
    kind: "success",
    title: "Cursor",
  });

  if (terminalStatuses.has(storedRecord.status)) {
    await handleTerminalAgent(fp, storedRecord, true);
  } else {
    startPolling(fp, storedRecord.agentId);
  }
}

async function stopAgent(fp: FpExtensionContext, issue: ExtensionIssue): Promise<void> {
  const initialRecord = await findRecord(fp.projectDir, issue.id);
  if (!initialRecord) {
    return;
  }

  await withAgentLock(initialRecord.agentId, async () => {
    const record = await findRecord(fp.projectDir, issue.id);
    if (!record) {
      return;
    }
    if (terminalStatuses.has(record.status)) {
      await fp.ui.notify("Cursor agent is already terminal.", { kind: "info", title: "Cursor" });
      return;
    }

    const apiKey = await resolveApiKey(fp);
    if (!apiKey) {
      await fp.ui.notify("Cursor API key not configured. Set it in Extensions settings.", {
        kind: "error",
        title: "Cursor",
      });
      return;
    }

    const pathTemplate = fp.config.get("cancel-path-template", "/v0/agents/{agentId}/stop");
    let res: Response;
    try {
      res = await cursorFetch(fp, apiKey, applyPathTemplate(pathTemplate, record), {
        method: "POST",
      });
    } catch (err) {
      await fp.ui.notify(`Failed to reach Cursor API: ${errorMessage(err)}`, {
        kind: "error",
        title: "Cursor",
      });
      return;
    }

    if (!res.ok) {
      const body = await safeResponseText(res);
      await fp.ui.notify(`Failed to stop Cursor agent (${res.status}): ${body}`, {
        kind: "error",
        title: "Cursor",
      });
      return;
    }

    stopPolling(record.agentId);
    const stopped = mergeRecord(record, { status: "stopped", pollFailureCount: 0 });
    await upsertRecord(fp.projectDir, stopped);
    await syncIssueProperties(fp, stopped, record);
    await fp.ui.notify("Cursor agent stopped", { kind: "warning", title: "Cursor" });
  });
}

async function sendLatestFollowUp(fp: FpExtensionContext, issue: ExtensionIssue): Promise<void> {
  const initialRecord = await findRecord(fp.projectDir, issue.id);
  if (!initialRecord || terminalStatuses.has(initialRecord.status)) {
    await fp.ui.notify("Cursor agent is not running.", { kind: "warning", title: "Cursor" });
    return;
  }

  await withAgentLock(initialRecord.agentId, async () => {
    const record = await findRecord(fp.projectDir, issue.id);
    if (!record || terminalStatuses.has(record.status)) {
      await fp.ui.notify("Cursor agent is not running.", { kind: "warning", title: "Cursor" });
      return;
    }

    const followUp = await findLatestFollowUpComment(fp, record);
    if (!followUp) {
      await fp.ui.notify('Add an issue comment starting with "/cursor " first.', {
        kind: "warning",
        title: "Cursor",
      });
      return;
    }

    if ((record.followUpCommentIds ?? []).includes(followUp.commentId)) {
      await fp.ui.notify("That Cursor follow-up comment was already sent.", {
        kind: "info",
        title: "Cursor",
      });
      return;
    }

    const apiKey = await resolveApiKey(fp);
    if (!apiKey) {
      await fp.ui.notify("Cursor API key not configured. Set it in Extensions settings.", {
        kind: "error",
        title: "Cursor",
      });
      return;
    }

    const pathTemplate = fp.config.get("followup-path-template", "/v0/agents/{agentId}/followup");
    let res: Response;
    try {
      res = await cursorFetch(fp, apiKey, applyPathTemplate(pathTemplate, record), {
        method: "POST",
        body: JSON.stringify({ prompt: { text: followUp.text } }),
      });
    } catch (err) {
      await fp.ui.notify(`Failed to reach Cursor API: ${errorMessage(err)}`, {
        kind: "error",
        title: "Cursor",
      });
      return;
    }

    if (!res.ok) {
      const body = await safeResponseText(res);
      await fp.ui.notify(`Failed to send Cursor follow-up (${res.status}): ${body}`, {
        kind: "error",
        title: "Cursor",
      });
      return;
    }

    const now = new Date().toISOString();
    const updated = mergeRecord(record, {
      followUpCommentIds: uniqueStrings([...(record.followUpCommentIds ?? []), followUp.commentId]),
      followUpSentAt: now,
    });
    await upsertRecord(fp.projectDir, updated);
    await fp.comments.create(
      issue.id,
      ["## Cursor Follow-up Sent", "", truncateText(followUp.text, 1_000)].join("\n"),
    );
    startPolling(fp, record.agentId);
    await fp.ui.notify("Cursor follow-up sent", { kind: "success", title: "Cursor" });
  });
}

async function findLatestFollowUpComment(
  fp: FpExtensionContext,
  record: CursorAgentRecord,
): Promise<{ readonly commentId: string; readonly text: string } | null> {
  const comments = await fp.comments.list(record.issueId);
  const sorted = [...comments].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );

  for (const comment of sorted) {
    const text = extractFollowUpText(comment.content);
    if (text) {
      return { commentId: comment.id, text };
    }
  }

  return null;
}

function extractFollowUpText(content: string): string | null {
  const trimmed = content.trim();
  for (const prefix of ["/cursor ", "@cursor "]) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      const text = trimmed.slice(prefix.length).trim();
      return text.length > 0 ? text : null;
    }
  }
  return null;
}

async function resumeActiveAgents(fp: FpExtensionContext): Promise<void> {
  const records = await loadRecords(fp.projectDir);
  for (const record of records) {
    if (!terminalStatuses.has(record.status)) {
      startPolling(fp, record.agentId);
    }
  }
}

function startPolling(fp: FpExtensionContext, agentId: string): void {
  if (activePollers.has(agentId)) {
    return;
  }

  const schedule = async () => {
    const record = await findRecordByAgentId(fp.projectDir, agentId);
    const delayMs = getNextPollDelayMs(fp, record);
    const timer = setTimeout(async () => {
      activePollers.delete(agentId);
      try {
        const record = await refreshAgent(fp, agentId, { notifyTerminal: true });
        if (record && !terminalStatuses.has(record.status)) {
          startPolling(fp, agentId);
        }
      } catch (err) {
        fp.log.warn(`Cursor poll failed for ${agentId}: ${errorMessage(err)}`);
        startPolling(fp, agentId);
      }
    }, delayMs);
    activePollers.set(agentId, timer);
  };

  void schedule();
}

function stopPolling(agentId: string): void {
  const timer = activePollers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    activePollers.delete(agentId);
  }
}

async function refreshAgent(
  fp: FpExtensionContext,
  agentId: string,
  opts: { notifyTerminal: boolean },
): Promise<CursorAgentRecord | null> {
  return withAgentLock(agentId, () => refreshAgentLocked(fp, agentId, opts));
}

async function refreshAgentLocked(
  fp: FpExtensionContext,
  agentId: string,
  opts: { notifyTerminal: boolean },
): Promise<CursorAgentRecord | null> {
  const existing = await findRecordByAgentId(fp.projectDir, agentId);
  if (!existing) {
    stopPolling(agentId);
    return null;
  }
  if (terminalStatuses.has(existing.status)) {
    stopPolling(agentId);
    return existing;
  }

  const apiKey = await resolveApiKey(fp);
  if (!apiKey) {
    fp.log.warn("Cursor API key not configured; skipping poll");
    return existing;
  }

  const pathTemplate = fp.config.get("status-path-template", "/v0/agents/{agentId}");
  const statusPollAt = new Date().toISOString();
  let res: Response;
  try {
    res = await cursorFetch(fp, apiKey, applyPathTemplate(pathTemplate, existing));
  } catch (err) {
    const failed = markPollFailure(existing, `status request failed: ${errorMessage(err)}`);
    await upsertRecord(fp.projectDir, failed);
    await syncIssueProperties(fp, failed, existing);
    fp.log.warn(`Cursor status API request failed: ${errorMessage(err)}`);
    return failed;
  }
  if (!res.ok) {
    const message = `status request returned ${res.status}: ${await safeResponseText(res)}`;
    const failed = markPollFailure(existing, message);
    await upsertRecord(fp.projectDir, failed);
    await syncIssueProperties(fp, failed, existing);
    fp.log.warn(`Cursor ${message}`);
    return failed;
  }

  const snapshot = extractApiSnapshot(await res.json());
  const nextStatus = snapshot.status ?? existing.status;
  const next = mergeRecord(existing, {
    status: nextStatus,
    runId: snapshot.runId ?? existing.runId,
    branch: snapshot.branch ?? existing.branch,
    prUrl: snapshot.prUrl ?? existing.prUrl,
    agentUrl: snapshot.agentUrl ?? existing.agentUrl,
    summary: snapshot.summary ?? existing.summary,
    error: snapshot.error ?? existing.error,
    launchCommentPostedAt: existing.launchCommentPostedAt,
    prCommentPostedAt: existing.prCommentPostedAt,
    summaryPostedAt: existing.summaryPostedAt,
    postedConversationMessageIds: existing.postedConversationMessageIds,
    lastConversationMessageId: existing.lastConversationMessageId,
    lastProgressText: existing.lastProgressText,
    lastStatusPollAt: statusPollAt,
    lastConversationPollAt: existing.lastConversationPollAt,
    lastSuccessfulPollAt: statusPollAt,
    pollFailureCount: 0,
    lastPollError: undefined,
    followUpCommentIds: existing.followUpCommentIds,
    followUpSentAt: existing.followUpSentAt,
  });

  if (next.status !== existing.status) {
    fp.log.info(`Cursor agent ${next.agentId} status: ${existing.status} -> ${next.status}`);
  }

  let storedRecord = await ensureLaunchComment(fp, next);
  storedRecord = await ensurePrComment(fp, storedRecord);
  storedRecord = await refreshConversation(fp, apiKey, storedRecord);
  await upsertRecord(fp.projectDir, storedRecord);
  await syncIssueProperties(fp, storedRecord, existing);

  if (terminalStatuses.has(storedRecord.status)) {
    stopPolling(storedRecord.agentId);
    await handleTerminalAgent(fp, storedRecord, opts.notifyTerminal);
  }

  return storedRecord;
}

async function ensureLaunchComment(
  fp: FpExtensionContext,
  record: CursorAgentRecord,
): Promise<CursorAgentRecord> {
  if (record.launchCommentPostedAt) {
    return record;
  }

  const comment = buildLaunchComment(record);
  if (!comment) {
    return record;
  }

  try {
    await fp.comments.create(record.issueId, comment);
  } catch (err) {
    fp.log.warn(`Failed to add Cursor launch comment: ${errorMessage(err)}`);
    return record;
  }

  const now = new Date().toISOString();
  fp.log.info(`Cursor agent ${record.agentId} launch comment posted`);
  return {
    ...record,
    launchCommentPostedAt: now,
    updatedAt: now,
  };
}

async function ensurePrComment(
  fp: FpExtensionContext,
  record: CursorAgentRecord,
): Promise<CursorAgentRecord> {
  if (!record.prUrl || record.prCommentPostedAt) {
    return record;
  }

  try {
    await fp.comments.create(
      record.issueId,
      ["## Cursor Pull Request Opened", "", `**PR:** ${record.prUrl}`].join("\n"),
    );
  } catch (err) {
    fp.log.warn(`Failed to add Cursor PR comment: ${errorMessage(err)}`);
    return record;
  }

  const now = new Date().toISOString();
  fp.log.info(`Cursor agent ${record.agentId} PR comment posted`);
  return {
    ...record,
    prCommentPostedAt: now,
    updatedAt: now,
  };
}

async function refreshConversation(
  fp: FpExtensionContext,
  apiKey: string,
  record: CursorAgentRecord,
): Promise<CursorAgentRecord> {
  const conversationPathTemplate = fp.config.get(
    "conversation-path-template",
    "/v0/agents/{agentId}/conversation",
  );
  const pollAt = new Date().toISOString();

  let res: Response;
  try {
    res = await cursorFetch(fp, apiKey, applyPathTemplate(conversationPathTemplate, record));
  } catch (err) {
    const failed = markPollFailure(record, `conversation request failed: ${errorMessage(err)}`);
    fp.log.warn(`Cursor conversation API request failed: ${errorMessage(err)}`);
    return {
      ...failed,
      lastConversationPollAt: pollAt,
    };
  }

  if (!res.ok) {
    const message = `conversation request returned ${res.status}: ${await safeResponseText(res)}`;
    fp.log.warn(`Cursor ${message}`);
    return {
      ...markPollFailure(record, message),
      lastConversationPollAt: pollAt,
    };
  }

  const messages = extractConversationMessages(await res.json());
  const progressMessages = getNewProgressMessages(fp, record, messages);
  const lastProgressMessage = last(progressMessages) ?? last(getProgressMessages(messages));
  let next = mergeRecord(record, {
    lastConversationPollAt: pollAt,
    lastSuccessfulPollAt: pollAt,
    lastConversationMessageId: last(messages)?.id ?? record.lastConversationMessageId,
    lastProgressText: lastProgressMessage
      ? summarizeProgressText(lastProgressMessage.text)
      : record.lastProgressText,
    pollFailureCount: 0,
    lastPollError: undefined,
  });

  if (progressMessages.length === 0 || !fp.config.get("progress-comments", true)) {
    return next;
  }

  const comment = buildProgressComment(fp, progressMessages);
  if (!comment) {
    return next;
  }

  try {
    await fp.comments.create(record.issueId, comment.content);
  } catch (err) {
    fp.log.warn(`Failed to add Cursor progress comment: ${errorMessage(err)}`);
    return next;
  }

  next = mergeRecord(next, {
    postedConversationMessageIds: uniqueStrings([
      ...(next.postedConversationMessageIds ?? []),
      ...comment.messageIds,
    ]),
  });
  fp.log.info(
    `Cursor agent ${record.agentId} posted ${comment.messageIds.length} progress update(s)`,
  );
  return next;
}

async function handleTerminalAgent(
  fp: FpExtensionContext,
  record: CursorAgentRecord,
  notify: boolean,
): Promise<void> {
  if (record.status === "finished") {
    if (!record.summaryPostedAt) {
      const autoComplete = fp.config.get<boolean>("auto-complete", false);
      if (autoComplete) {
        await fp.issues.update(record.issueId, { status: "done" });
      }

      const summary = buildSummary(record);
      if (summary) {
        await fp.comments.create(record.issueId, summary);
      }

      await upsertRecord(fp.projectDir, {
        ...record,
        summaryPostedAt: new Date().toISOString(),
      });
    }

    if (notify) {
      await fp.ui.notify("Cursor agent finished", { kind: "success", title: "Cursor" });
    }
    return;
  }

  if (record.status === "error" && notify) {
    await fp.ui.notify(`Cursor agent failed: ${record.error ?? "unknown error"}`, {
      kind: "error",
      title: "Cursor",
    });
  }
}

async function buildPrompt(fp: FpExtensionContext, issue: ExtensionIssue): Promise<string> {
  const children: ExtensionIssue[] = await fp.issues.list({ parent: issue.id });
  const comments: ExtensionComment[] = await fp.comments.list(issue.id);
  const title = typeof issue.title === "string" && issue.title.length > 0 ? issue.title : issue.id;
  const description = typeof issue.description === "string" ? issue.description : "";

  const sections: string[] = [];
  sections.push(`# ${title}`);
  sections.push(
    [
      "## Issue Metadata",
      `- ID: ${issue.id}`,
      `- Status: ${issue.status}`,
      `- Priority: ${issue.priority ?? "none"}`,
    ].join("\n"),
  );

  if (description.trim().length > 0) {
    sections.push(`## Description\n${description}`);
  }

  if (children.length > 0) {
    const checklist = children.map(
      (child) =>
        `- [${child.status === "done" ? "x" : " "}] ${child.title || child.id} (${child.status})`,
    );
    sections.push(`## Subtasks\n${checklist.join("\n")}`);
  }

  if (comments.length > 0) {
    const discussion = comments
      .map((comment) => {
        const content = typeof comment.content === "string" ? comment.content : "";
        return `> ${comment.author} at ${comment.createdAt}:\n> ${content}`;
      })
      .join("\n\n");
    sections.push(`## Discussion\n${discussion}`);
  }

  const guidelines = await readProjectGuidelines(fp.projectDir);
  if (guidelines) {
    sections.push(`## Project Guidelines\n${guidelines}`);
  }

  sections.push(
    [
      "## Instructions",
      "- Keep changes focused on this issue.",
      "- Preserve existing architecture and coding conventions.",
      "- Run relevant checks/tests for touched code.",
      "- Open or update a pull request if Cursor is configured to do so.",
      "- Provide a concise summary of what changed and why.",
    ].join("\n"),
  );

  return sections.join("\n\n");
}

async function readProjectGuidelines(projectDir: string): Promise<string | null> {
  const candidates = [
    path.join(projectDir, "AGENTS.md"),
    path.join(projectDir, ".cursor", "rules"),
  ];

  for (const candidate of candidates) {
    try {
      const candidateStat = await stat(candidate).catch(() => null);
      if (!candidateStat) {
        continue;
      }

      let content: string;
      if (candidateStat.isDirectory()) {
        const entries = (await readdir(candidate)).filter((entry) => !entry.startsWith(".")).sort();

        const parts: string[] = [];
        for (const entry of entries) {
          const entryPath = path.join(candidate, entry);
          const entryStat = await stat(entryPath);
          if (!entryStat.isFile()) {
            continue;
          }

          const text = (await readFile(entryPath, "utf-8")).trim();
          if (text.length > 0) {
            parts.push(`### ${entry}\n\n${text}`);
          }
        }
        content = parts.join("\n\n");
      } else {
        content = (await readFile(candidate, "utf-8")).trim();
      }

      if (content.length === 0) {
        continue;
      }

      if (content.length > MAX_PROJECT_GUIDELINES_CHARS) {
        return `${content.slice(0, MAX_PROJECT_GUIDELINES_CHARS)}\n\n... (truncated)`;
      }

      return content;
    } catch {
      // Best effort. Unreadable guidance files should not block launch.
    }
  }

  return null;
}

async function loadRecords(projectDir: string): Promise<CursorAgentRecord[]> {
  const file = storePath(projectDir);
  if (!existsSync(file)) {
    return [];
  }

  try {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(coerceCursorAgentRecord).filter(isPresent);
    }
    if (isRecordObject(parsed) && Array.isArray(parsed.agents)) {
      return parsed.agents.map(coerceCursorAgentRecord).filter(isPresent);
    }
  } catch {
    // Treat malformed stores as empty; the next write will repair the file.
  }

  return [];
}

async function saveRecords(
  projectDir: string,
  records: readonly CursorAgentRecord[],
): Promise<void> {
  const file = storePath(projectDir);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify([...records], null, 2)}\n`, "utf-8");
  await rename(tmp, file);
}

async function findRecord(projectDir: string, issueId: string): Promise<CursorAgentRecord | null> {
  const records = await loadRecords(projectDir);
  return records.find((record) => record.issueId === issueId) ?? null;
}

async function findRecordByAgentId(
  projectDir: string,
  agentId: string,
): Promise<CursorAgentRecord | null> {
  const records = await loadRecords(projectDir);
  return records.find((record) => record.agentId === agentId) ?? null;
}

async function upsertRecord(projectDir: string, record: CursorAgentRecord): Promise<void> {
  await withStoreLock(projectDir, async () => {
    const records = await loadRecords(projectDir);
    const index = records.findIndex((existing) => existing.issueId === record.issueId);
    if (index === -1) {
      records.push(record);
    } else {
      records[index] = mergeStoredRecord(records[index], record);
    }
    await saveRecords(projectDir, records);
  });
}

async function withIssueLock<T>(issueId: string, operation: () => Promise<T>): Promise<T> {
  const previous = issueQueues.get(issueId) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(
    () => current,
    () => current,
  );
  issueQueues.set(issueId, queued);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (issueQueues.get(issueId) === queued) {
      issueQueues.delete(issueId);
    }
  }
}

async function withAgentLock<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
  const previous = agentQueues.get(agentId) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(
    () => current,
    () => current,
  );
  agentQueues.set(agentId, queued);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (agentQueues.get(agentId) === queued) {
      agentQueues.delete(agentId);
    }
  }
}

async function withStoreLock<T>(projectDir: string, operation: () => Promise<T>): Promise<T> {
  const key = storePath(projectDir);
  const previous = storeQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(
    () => current,
    () => current,
  );
  storeQueues.set(key, queued);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (storeQueues.get(key) === queued) {
      storeQueues.delete(key);
    }
  }
}

function mergeStoredRecord(
  latest: CursorAgentRecord,
  incoming: CursorAgentRecord,
): CursorAgentRecord {
  const latestIsTerminal = terminalStatuses.has(latest.status);
  const incomingIsTerminal = terminalStatuses.has(incoming.status);
  if (latestIsTerminal && !incomingIsTerminal && latest.agentId !== incoming.agentId) {
    return incoming;
  }

  const status = latestIsTerminal && !incomingIsTerminal ? latest.status : incoming.status;

  return {
    ...latest,
    ...incoming,
    status,
    launchCommentPostedAt: latest.launchCommentPostedAt ?? incoming.launchCommentPostedAt,
    prCommentPostedAt: latest.prCommentPostedAt ?? incoming.prCommentPostedAt,
    summaryPostedAt: latest.summaryPostedAt ?? incoming.summaryPostedAt,
    postedConversationMessageIds: uniqueStrings([
      ...(latest.postedConversationMessageIds ?? []),
      ...(incoming.postedConversationMessageIds ?? []),
    ]),
    followUpCommentIds: uniqueStrings([
      ...(latest.followUpCommentIds ?? []),
      ...(incoming.followUpCommentIds ?? []),
    ]),
    finishedAt: latest.finishedAt ?? incoming.finishedAt,
  };
}

function mergeRecord(
  record: CursorAgentRecord,
  patch: Partial<Omit<CursorAgentRecord, "issueId" | "agentId" | "launchedAt">>,
): CursorAgentRecord {
  const status = patch.status ?? record.status;
  const now = new Date().toISOString();
  return {
    ...record,
    ...patch,
    status,
    updatedAt: now,
    finishedAt: terminalStatuses.has(status) ? (record.finishedAt ?? now) : undefined,
  };
}

function markPollFailure(record: CursorAgentRecord, message: string): CursorAgentRecord {
  return mergeRecord(record, {
    pollFailureCount: (record.pollFailureCount ?? 0) + 1,
    lastPollError: truncateText(message, 500),
  });
}

function getNextPollDelayMs(fp: FpExtensionContext, record: CursorAgentRecord | null): number {
  const baseMs = Math.max(5_000, fp.config.get("poll-interval-ms", POLL_INTERVAL_MS));
  const maxMs = Math.max(baseMs, fp.config.get("poll-backoff-max-ms", POLL_BACKOFF_MAX_MS));
  const failures = record?.pollFailureCount ?? 0;
  if (failures === 0) {
    return baseMs;
  }

  const exponential = baseMs * 2 ** Math.min(failures - 1, 4);
  const jitter = Math.floor(Math.random() * Math.min(5_000, baseMs));
  return Math.min(maxMs, exponential + jitter);
}

async function syncIssueProperties(
  fp: FpExtensionContext,
  record: CursorAgentRecord,
  previous?: CursorAgentRecord,
): Promise<void> {
  if (previous && propertiesEqual(buildIssueProperties(previous), buildIssueProperties(record))) {
    return;
  }

  await fp.issues.update(record.issueId, {
    properties: buildIssueProperties(record),
  });
}

function buildIssueProperties(record: CursorAgentRecord): Record<string, string> {
  return {
    [PROPERTY_KEY]: record.status,
    [STAGE_PROPERTY_KEY]: deriveStage(record),
    [HEALTH_PROPERTY_KEY]: deriveHealth(record),
    [LAST_UPDATE_PROPERTY_KEY]: record.lastProgressText ?? "",
    [PR_PROPERTY_KEY]: record.prUrl ?? "",
  };
}

function propertiesEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

function deriveStage(record: CursorAgentRecord): CursorAgentStage {
  switch (record.status) {
    case "creating":
      return "queued";
    case "running":
      return record.prUrl ? "pr-opened" : "working";
    case "finished":
      return "finished";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
    case "expired":
      return "expired";
  }
}

function deriveHealth(record: CursorAgentRecord): CursorAgentHealth {
  const failures = record.pollFailureCount ?? 0;
  if (failures >= 3) {
    return "stale";
  }
  if (failures > 0) {
    return "degraded";
  }
  return "ok";
}

function storePath(projectDir: string): string {
  return path.join(projectDir, STORE_FILE);
}

function getIssueFromContext(ctx: Record<string, unknown>): ExtensionIssue | null {
  const issue = ctx.issue;
  if (!isRecordObject(issue)) {
    return null;
  }
  if (typeof issue.id !== "string" || typeof issue.title !== "string") {
    return null;
  }
  return issue as unknown as ExtensionIssue;
}

function extractApiSnapshot(value: unknown): CursorApiSnapshot {
  const root = isRecordObject(value) ? value : {};
  const agent = isRecordObject(root.agent) ? root.agent : root;
  const run = isRecordObject(root.run) ? root.run : undefined;
  const source = isRecordObject(root.source) ? root.source : undefined;
  const target = isRecordObject(root.target) ? root.target : undefined;

  const rawStatus = firstString(root.status, agent.status, run?.status);
  const status = normalizeStatus(rawStatus);

  return {
    agentId: firstString(root.id, root.agentId, agent.id, agent.agentId),
    runId: firstString(root.runId, run?.id, run?.runId),
    status,
    branch: firstString(
      root.branch,
      root.branchName,
      agent.branch,
      agent.branchName,
      run?.branch,
      target?.branchName,
    ),
    prUrl: firstString(
      root.pullRequestUrl,
      root.prUrl,
      agent.pullRequestUrl,
      agent.prUrl,
      source?.prUrl,
      target?.prUrl,
    ),
    agentUrl: firstString(root.url, root.agentUrl, agent.url, agent.agentUrl, target?.url),
    summary: firstString(root.summary, agent.summary, run?.summary),
    error: firstString(root.error, root.message, agent.error, run?.error),
  };
}

function extractConversationMessages(value: unknown): CursorConversationMessage[] {
  const root = isRecordObject(value) ? value : {};
  const rawMessages = Array.isArray(value)
    ? value
    : Array.isArray(root.messages)
      ? root.messages
      : Array.isArray(root.conversation)
        ? root.conversation
        : [];

  return rawMessages.map(coerceConversationMessage).filter(isPresent);
}

function coerceConversationMessage(value: unknown): CursorConversationMessage | null {
  if (!isRecordObject(value)) {
    return null;
  }

  const id = firstString(value.id, value.messageId);
  const type = firstString(value.type, value.role, value.kind);
  const text = firstString(value.text, value.content, value.message);
  if (!id || !type || !text) {
    return null;
  }

  return {
    id,
    type,
    text,
    createdAt: firstString(value.createdAt, value.timestamp),
  };
}

function getNewProgressMessages(
  fp: FpExtensionContext,
  record: CursorAgentRecord,
  messages: readonly CursorConversationMessage[],
): CursorConversationMessage[] {
  const posted = new Set(record.postedConversationMessageIds ?? []);
  const minChars = fp.config.get("progress-min-message-chars", PROGRESS_MIN_MESSAGE_CHARS);
  return getProgressMessages(messages).filter(
    (message) => !posted.has(message.id) && message.text.trim().length >= minChars,
  );
}

function getProgressMessages(
  messages: readonly CursorConversationMessage[],
): CursorConversationMessage[] {
  return messages.filter((message) => {
    const type = message.type.toLowerCase();
    return type.includes("assistant") && message.text.trim().length > 0;
  });
}

function normalizeStatus(value: string | undefined): CursorAgentStatus | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase().replaceAll("_", "-");
  switch (normalized) {
    case "creating":
    case "created":
    case "pending":
    case "queued":
      return "creating";
    case "running":
    case "in-progress":
    case "active":
      return "running";
    case "finished":
    case "complete":
    case "completed":
    case "success":
    case "succeeded":
      return "finished";
    case "stopped":
    case "stop":
    case "cancelled":
    case "canceled":
      return "stopped";
    case "error":
    case "failed":
    case "failure":
      return "error";
    case "expired":
    case "archived":
      return "expired";
    default:
      return undefined;
  }
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function firstNumber(...values: readonly unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.filter((item): item is string => typeof item === "string"));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function last<T>(values: readonly T[]): T | undefined {
  return values.length > 0 ? values[values.length - 1] : undefined;
}

function summarizeProgressText(text: string): string {
  return truncateText(text.replace(/\s+/g, " ").trim(), 180);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 15)).trimEnd()}... (truncated)`;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceCursorAgentRecord(value: unknown): CursorAgentRecord | null {
  if (!isRecordObject(value)) {
    return null;
  }

  const issueId = firstString(value.issueId);
  const agentId = firstString(value.agentId, value.id);
  const status = normalizeStatus(firstString(value.status));
  if (!issueId || !agentId || !status) {
    return null;
  }

  const launchedAt = firstString(value.launchedAt, value.createdAt) ?? new Date().toISOString();
  const updatedAt = firstString(value.updatedAt, value.finishedAt, value.launchedAt) ?? launchedAt;

  return {
    issueId,
    agentId,
    runId: firstString(value.runId),
    status,
    branch: firstString(value.branch, value.branchName),
    prUrl: firstString(value.prUrl, value.pullRequestUrl),
    agentUrl: firstString(value.agentUrl, value.cursorUrl, value.url),
    summary: firstString(value.summary),
    launchCommentPostedAt: firstString(value.launchCommentPostedAt),
    prCommentPostedAt: firstString(value.prCommentPostedAt),
    summaryPostedAt: firstString(value.summaryPostedAt),
    postedConversationMessageIds: stringArray(value.postedConversationMessageIds),
    lastConversationMessageId: firstString(value.lastConversationMessageId),
    lastProgressText: firstString(value.lastProgressText),
    lastStatusPollAt: firstString(value.lastStatusPollAt),
    lastConversationPollAt: firstString(value.lastConversationPollAt),
    lastSuccessfulPollAt: firstString(value.lastSuccessfulPollAt),
    pollFailureCount: firstNumber(value.pollFailureCount) ?? 0,
    lastPollError: firstString(value.lastPollError),
    followUpCommentIds: stringArray(value.followUpCommentIds),
    followUpSentAt: firstString(value.followUpSentAt),
    error: firstString(value.error),
    launchedAt,
    updatedAt,
    finishedAt: firstString(value.finishedAt),
  };
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

function buildSummary(record: CursorAgentRecord): string | null {
  const lines = ["## Cursor Agent Summary"];

  if (record.summary) {
    lines.push("", record.summary);
  }

  if (record.branch) {
    lines.push("", `**Branch:** \`${record.branch}\``);
  }

  if (record.prUrl) {
    lines.push(`**PR:** ${record.prUrl}`);
  }

  if (record.agentUrl) {
    lines.push(`**Agent:** ${record.agentUrl}`);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function buildLaunchComment(record: CursorAgentRecord): string | null {
  const lines = ["## Cursor Agent Launched"];

  if (record.agentUrl) {
    lines.push("", `**Agent:** ${record.agentUrl}`);
  }

  if (record.branch) {
    lines.push(`**Branch:** \`${record.branch}\``);
  }

  lines.push(`**Status:** ${record.status}`);

  return lines.length > 1 ? lines.join("\n") : null;
}

function buildProgressComment(
  fp: FpExtensionContext,
  messages: readonly CursorConversationMessage[],
): ProgressComment | null {
  if (messages.length === 0) {
    return null;
  }

  const maxMessageChars = fp.config.get("progress-max-message-chars", PROGRESS_MAX_MESSAGE_CHARS);
  const maxCommentChars = fp.config.get("progress-max-comment-chars", PROGRESS_MAX_COMMENT_CHARS);
  const lines = ["## Cursor Agent Progress"];
  const messageIds: string[] = [];

  for (const [index, message] of messages.entries()) {
    const update = truncateText(message.text.trim(), maxMessageChars);
    const nextLines = ["", `### Update ${index + 1}`, update];
    const candidate = [...lines, ...nextLines].join("\n");
    if (candidate.length > maxCommentChars) {
      lines.push("", "... additional Cursor progress omitted to keep this comment readable.");
      break;
    }
    lines.push(...nextLines);
    messageIds.push(message.id);
  }

  if (messageIds.length === 0) {
    return null;
  }

  return {
    content: lines.join("\n"),
    messageIds,
  };
}

function buildAgentUrl(agentId: string): string {
  return `https://cursor.com/agents/${encodeURIComponent(agentId)}`;
}

function buildBranchName(issue: ExtensionIssue): string {
  const title = typeof issue.title === "string" ? issue.title : issue.id;
  const slug = slugify(title).slice(0, 50) || "issue";
  return `cursor/${slug}-${issue.id.slice(0, 8)}`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getLaunchPath(fp: FpExtensionContext): string {
  return fp.config.get("launch-path", "/v0/agents");
}

function getApiBase(fp: FpExtensionContext): string {
  return fp.config.get("api-base", CURSOR_API_BASE).replace(/\/+$/, "");
}

async function resolveApiKey(fp: FpExtensionContext): Promise<string | undefined> {
  const configured = fp.config.get<string>("api-key");
  if (configured && !configured.startsWith("secret:")) {
    return configured;
  }

  return (await fp.secrets.get("api-key")) ?? (await fp.secrets.get("cursor-agent.api-key"));
}

function applyPathTemplate(
  template: string,
  record: Pick<CursorAgentRecord, "agentId" | "runId">,
): string {
  return template
    .replaceAll("{agentId}", encodeURIComponent(record.agentId))
    .replaceAll("{runId}", encodeURIComponent(record.runId ?? ""));
}

async function cursorFetch(
  fp: FpExtensionContext,
  apiKey: string,
  requestPath: string,
  init?: RequestInit,
): Promise<Response> {
  const authScheme = fp.config.get<"basic" | "bearer">("auth-scheme", "bearer");
  const authorization =
    authScheme === "bearer"
      ? `Bearer ${apiKey}`
      : `Basic ${Buffer.from(`${apiKey}:`, "utf-8").toString("base64")}`;

  return fetch(`${getApiBase(fp)}${requestPath}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: authorization,
      "Content-Type": "application/json",
    },
  });
}

async function safeResponseText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.trim() || response.statusText;
}

async function getGitSource(repoPath: string): Promise<GitSource> {
  const [repository, ref] = await Promise.all([
    getGitRemoteUrl(repoPath),
    getDefaultRemoteBranch(repoPath),
  ]);
  return { repository, ref };
}

async function getGitRemoteUrl(repoPath: string): Promise<string> {
  const remote = await resolveRemoteName(repoPath);
  const url = await gitExec(["remote", "get-url", remote], repoPath);
  return normalizeGitHubUrl(url);
}

async function getDefaultRemoteBranch(repoPath: string): Promise<string> {
  const remote = await resolveRemoteName(repoPath);

  try {
    const symref = await gitExec(
      ["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`],
      repoPath,
    );
    const prefix = `${remote}/`;
    const branch = symref.startsWith(prefix) ? symref.slice(prefix.length) : symref;
    if (branch.length > 0) {
      return branch;
    }
  } catch {
    // Fall through to common branch names.
  }

  for (const candidate of ["main", "master"]) {
    try {
      await gitExec(["rev-parse", "--verify", `refs/remotes/${remote}/${candidate}`], repoPath);
      return candidate;
    } catch {
      // Try the next common branch name.
    }
  }

  const branch = await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
  if (branch === "HEAD") {
    return gitExec(["rev-parse", "--short", "HEAD"], repoPath);
  }
  return branch;
}

async function resolveRemoteName(repoPath: string): Promise<string> {
  try {
    await gitExec(["remote", "get-url", "origin"], repoPath);
    return "origin";
  } catch {
    const remotes = await gitExec(["remote"], repoPath);
    const firstRemote = remotes.split("\n")[0]?.trim();
    if (!firstRemote) {
      throw new Error("No git remotes configured. Cursor agents require a GitHub remote.");
    }
    return firstRemote;
  }
}

function normalizeGitHubUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();
  const sshMatch = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?\/?(?:\?.*)?$/);
  if (sshMatch) {
    return validateRepoPath(sshMatch[1], trimmed);
  }

  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@github\.com\/(.+?)(?:\.git)?\/?(?:\?.*)?$/);
  if (sshUrlMatch) {
    return validateRepoPath(sshUrlMatch[1], trimmed);
  }

  const httpsMatch = trimmed.match(
    /^https:\/\/(?:[^@]+@)?github\.com\/(.+?)(?:\.git)?\/?(?:\?.*)?$/,
  );
  if (httpsMatch) {
    return validateRepoPath(httpsMatch[1], trimmed);
  }

  throw new Error(
    `Not a GitHub remote URL: "${trimmed}". Cursor agents require a GitHub repository.`,
  );
}

function validateRepoPath(repoPath: string, originalUrl: string): string {
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repoPath)) {
    return `https://github.com/${repoPath}`;
  }

  throw new Error(
    `Malformed GitHub repository path "${repoPath}" from remote "${originalUrl}". Expected "owner/repo".`,
  );
}

function gitExec(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", [...args], { cwd, timeout: 10_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = isRecordObject(error.cause) ? error.cause : null;
    const causeMessage = typeof cause?.message === "string" ? cause.message : undefined;
    const causeCode = typeof cause?.code === "string" ? cause.code : undefined;
    if (causeMessage && causeCode) {
      return `${error.message}: ${causeMessage} (${causeCode})`;
    }
    if (causeMessage) {
      return `${error.message}: ${causeMessage}`;
    }
    return error.message;
  }
  return String(error);
}
