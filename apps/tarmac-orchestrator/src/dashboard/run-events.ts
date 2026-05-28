import { inferCursorRunUrl } from "@tarmac/cursor-client";

import type { PersistedOrchestratorEvent } from "../local-state/types";
import type { LogExcerptRowView, RunTimelineEntryView } from "./types";

const issueLabel = (event: PersistedOrchestratorEvent): string | undefined => {
  if (!("issue" in event) || event.issue === undefined) {
    return undefined;
  }

  return event.issue.displayId ?? event.issue.issueId;
};

const eventSeverity = (type: string): LogExcerptRowView["severity"] => {
  if (type === "dispatch.failed" || type === "claim.lost") {
    return "error";
  }
  if (type === "issue.ineligible") {
    return "warn";
  }
  return "info";
};

const eventMessage = (event: PersistedOrchestratorEvent): string => {
  switch (event.type) {
    case "run.started":
      return `command ${event.command}`;
    case "run.finished":
      return `status ${event.status}`;
    case "scan.started":
      return "scan started";
    case "scan.finished":
      return `eligible ${event.eligible.length}, ineligible ${event.ineligible.length}`;
    case "issue.ineligible":
      return event.reason;
    case "claim.attempt":
      return "claim attempt";
    case "claim.success":
      return `claim ${event.claimId} attempt ${event.attempt}`;
    case "claim.lost":
      return event.reason;
    case "cursor.launch":
    case "metadata.persisted":
      return inferCursorRunUrl(event.cursorRun.agentId);
    case "reconcile.started":
      return "reconcile started";
    case "reconcile.finished":
      return event.tarmacState === undefined ? "reconcile finished" : `state ${event.tarmacState}`;
    case "dispatch.failed":
      return `${event.stage}: ${event.error}`;
    case "terminal.result":
      return event.prUrl ?? inferCursorRunUrl(event.cursorRun.agentId);
    case "watch.iteration":
      return `iteration ${event.iteration}`;
  }
};

const timelineStatus = (type: string): RunTimelineEntryView["status"] => {
  if (type === "dispatch.failed" || type === "claim.lost") {
    return "bad";
  }
  if (type === "run.finished") {
    return "ok";
  }
  if (type === "cursor.launch" || type === "terminal.result" || type === "claim.success") {
    return "ok";
  }
  if (type === "issue.ineligible") {
    return "warn";
  }
  if (type === "run.started" || type === "scan.started" || type === "reconcile.started") {
    return "running";
  }
  return "neutral";
};

const timelineLabel = (event: PersistedOrchestratorEvent): string => {
  switch (event.type) {
    case "run.started":
      return "Run started";
    case "run.finished":
      return "Run finished";
    case "scan.started":
      return "Scan started";
    case "scan.finished":
      return "Scan finished";
    case "claim.attempt":
      return "Claim attempt";
    case "claim.success":
      return "Claim succeeded";
    case "claim.lost":
      return "Claim lost";
    case "cursor.launch":
      return "Cursor launched";
    case "metadata.persisted":
      return "Metadata persisted";
    case "reconcile.started":
      return "Reconcile started";
    case "reconcile.finished":
      return "Reconcile finished";
    case "dispatch.failed":
      return "Dispatch failed";
    case "terminal.result":
      return "Terminal result";
    case "issue.ineligible":
      return "Issue ineligible";
    case "watch.iteration":
      return "Watch iteration";
  }
};

export const buildLogRows = (
  events: readonly PersistedOrchestratorEvent[],
  limit: number,
): readonly LogExcerptRowView[] =>
  events.slice(-limit).map((event) => {
    const label = issueLabel(event);
    return {
      timestamp: event.ts,
      type: event.type,
      severity: eventSeverity(event.type),
      message: eventMessage(event),
      ...(label === undefined ? {} : { issue: label }),
    };
  });

export const buildRunTimeline = (
  events: readonly PersistedOrchestratorEvent[],
): readonly RunTimelineEntryView[] =>
  events.map((event) => {
    const label = issueLabel(event);
    return {
      at: event.ts,
      label: timelineLabel(event),
      status: timelineStatus(event.type),
      detail: eventMessage(event),
      ...(label === undefined ? {} : { issue: label }),
    };
  });

export const buildIssueTimeline = (
  events: readonly PersistedOrchestratorEvent[],
  issueId: string,
): readonly RunTimelineEntryView[] =>
  buildRunTimeline(
    events.filter(
      (event) => "issue" in event && event.issue !== undefined && event.issue.issueId === issueId,
    ),
  );
