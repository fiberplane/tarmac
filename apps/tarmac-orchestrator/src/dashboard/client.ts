export const dashboardJs = `
const el = (id) => document.getElementById(id);

const state = {
  selectedIssueId: null,
  selectedRunId: null,
  status: null,
};

const esc = (value) => {
  if (value === undefined || value === null) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
};

const unavailable = () => '<span class="empty">Unavailable</span>';

const issueLabel = (issue) => esc(issue.displayId ?? issue.id);

const link = (href, label) => {
  if (!href) return esc(label ?? "");
  return '<a href="' + esc(href) + '" target="_blank" rel="noreferrer">' + esc(label ?? href) + "</a>";
};

const reasonText = (reason) => {
  if (!reason) return "";
  if (reason.kind === "blocked-by-dependency") {
    return reason.dependencyId ? "Blocked by " + esc(reason.dependencyId) : "Blocked by dependency";
  }
  if (reason.kind === "blocked-by-open-child") {
    return reason.childId ? "Blocked by child " + esc(reason.childId) : "Blocked by open child";
  }
  if (reason.kind === "not-todo") return reason.status ? "Status " + esc(reason.status) : "Not todo";
  return esc(reason.kind);
};

const scanBadge = (source) => {
  const cls = source === "live" ? "live" : source === "cached" ? "cached" : "unavailable";
  const label = source === "live" ? "Live scan" : source === "cached" ? "Cached scan" : "Scan unavailable";
  return '<span class="scan-badge ' + cls + '">' + label + "</span>";
};

const tagClass = (status) => {
  if (status === "ok" || status === "completed") return "ok";
  if (status === "warn" || status === "running") return status === "running" ? "run" : "warn";
  if (status === "bad" || status === "failed" || status === "error") return "bad";
  return "neutral";
};

const findIssue = (status, issueId) => status.issues.find((issue) => issue.id === issueId);

const findIneligibleReason = (status, issueId) => {
  const entry = status.scan.ineligible.find((row) => row.issue.id === issueId);
  return entry?.reason;
};

const renderQueue = (status) => {
  if (!status.issueQueue?.length) {
    if (status.scan.source === "unavailable" && !status.issues.length) {
      return '<p class="empty">No scan data yet. FP unavailable and no cached scan in recent runs.</p>';
    }
    if (!status.issues.length) {
      return '<p class="empty">No issues in the current status payload.</p>';
    }
    return '<p class="empty">No queue groups could be classified from current data.</p>';
  }

  return status.issueQueue
    .map((group) => {
      const rows = group.issues
        .map((issue) => {
          const selected = state.selectedIssueId === issue.id ? ' aria-selected="true"' : "";
          const sub = issue.title ? esc(issue.title) : "";
          return (
            '<button type="button" class="select-row issue-row" data-issue-id="' +
            esc(issue.id) +
            '"' +
            selected +
            '><div class="row-title">' +
            issueLabel(issue) +
            '</div><div class="row-sub">' +
            sub +
            "</div></button>"
          );
        })
        .join("");
      return '<div class="group-block"><div class="group-label">' + esc(group.label) + " (" + group.issues.length + ")</div>" + rows + "</div>";
    })
    .join("");
};

const field = (label, valueHtml) =>
  "<dt>" + esc(label) + "</dt><dd>" + (valueHtml || unavailable()) + "</dd>";

const renderDetail = (status) => {
  const issue = state.selectedIssueId ? findIssue(status, state.selectedIssueId) : null;
  if (!issue) {
    return '<p class="empty">Select an issue from the queue to inspect details.</p>';
  }

  const t = issue.tarmac ?? {};
  const ineligibleReason = findIneligibleReason(status, issue.id);
  const eligibility =
    issue.eligibility?.kind === "ineligible"
      ? reasonText(issue.eligibility.reason)
      : ineligibleReason
        ? reasonText(ineligibleReason)
        : issue.eligibility?.kind === "eligible"
          ? "Eligible"
          : null;

  const deps = issue.dependencies?.length
    ? issue.dependencies.map((dep) => esc(dep)).join(", ")
    : null;

  return (
    '<dl class="detail-grid">' +
    field("Issue", issueLabel(issue)) +
    field("Title", issue.title ? esc(issue.title) : null) +
    field("FP status", issue.status ? esc(issue.status) : null) +
    field("Eligibility", eligibility ? esc(eligibility) : null) +
    field("Parent", issue.parent ? esc(issue.parent) : null) +
    field("Dependencies", deps) +
    field("Ready", t.ready ? esc(t.ready) : null) +
    field("Tarmac state", t.state ? esc(t.state) : null) +
    field("Cursor", t.cursorUrl ? link(t.cursorUrl, "Open run") : null) +
    field("Branch", t.branch ? esc(t.branch) : null) +
    field("PR", t.prUrl ? link(t.prUrl, "PR" + (t.prNumber ? " #" + esc(t.prNumber) : "")) : null) +
    field("Base SHA", t.baseSha ? esc(t.baseSha) : null) +
    field("Head SHA", t.headSha ? esc(t.headSha) : null) +
    field("Last error", t.lastError ? '<span class="tag bad">' + esc(t.lastError) + "</span>" : null) +
    "</dl>"
  );
};

const renderBouts = (bouts) => {
  if (!bouts.length) return '<p class="empty">No parent/child bouts in the current payload.</p>';
  return bouts
    .map((bout) => {
      const children = bout.children
        .map((child) => {
          const t = child.tarmac ?? {};
          const bits = [
            child.eligibility?.kind === "ineligible" ? reasonText(child.eligibility.reason) : child.eligibility?.kind === "eligible" ? "Eligible" : "",
            t.state ? "state " + esc(t.state) : "",
            t.lastError ? "error: " + esc(t.lastError) : "",
            t.cursorUrl ? link(t.cursorUrl, "Cursor") : "",
            t.prUrl ? link(t.prUrl, "PR") : "",
          ].filter(Boolean);
          return "<li>" + issueLabel(child) + (bits.length ? " — " + bits.join(" · ") : "") + "</li>";
        })
        .join("");
      return (
        '<div class="bout-card"><div class="bout-parent">' +
        issueLabel(bout.parent) +
        (bout.parent.title ? " · " + esc(bout.parent.title) : "") +
        '</div><ul class="bout-children">' +
        children +
        "</ul></div>"
      );
    })
    .join("");
};

const renderRuns = (runs) => {
  if (!runs.length) return '<p class="empty">No local runs recorded in .tarmac/runs.jsonl.</p>';
  return runs
    .map((run) => {
      const selected = state.selectedRunId === run.runId ? ' aria-selected="true"' : "";
      const summary = run.summary ?? {};
      const statusClass = tagClass(run.status);
      const summaryBits = [
        summary.iterations !== undefined ? "iter " + esc(summary.iterations) : "",
        summary.dispatchedCount !== undefined ? "dispatched " + esc(summary.dispatchedCount) : "",
        summary.error ? esc(summary.error) : "",
      ].filter(Boolean);
      const corrupt =
        run.corruptEventLineCount && run.corruptEventLineCount > 0
          ? '<span class="tag warn">Corrupt lines ' + esc(run.corruptEventLineCount) + "</span>"
          : "";
      return (
        '<button type="button" class="select-row run-row" data-run-id="' +
        esc(run.runId) +
        '"' +
        selected +
        '><div class="row-title"><span class="tag ' +
        statusClass +
        '">' +
        esc(run.status) +
        "</span> " +
        esc(run.command) +
        (run.cursorMode ? " · " + esc(run.cursorMode) : "") +
        '</div><div class="row-sub">' +
        esc(run.runId.slice(0, 8)) +
        " · started " +
        esc(run.startedAt) +
        (run.finishedAt ? " → " + esc(run.finishedAt) : "") +
        (summaryBits.length ? " · " + summaryBits.join(" · ") : "") +
        corrupt +
        "</div></button>"
      );
    })
    .join("");
};

const renderTimeline = (status) => {
  const run = state.selectedRunId
    ? status.runs.find((entry) => entry.runId === state.selectedRunId)
    : status.runs[0];
  if (!run) return '<p class="empty">Select a run to view its dispatch timeline.</p>';

  let entries = run.timeline ?? [];
  if (state.selectedIssueId) {
    const issue = findIssue(status, state.selectedIssueId);
    const label = issue ? issue.displayId ?? issue.id : state.selectedIssueId;
    const filtered = entries.filter((entry) => entry.issue === label || entry.issue === state.selectedIssueId);
    if (filtered.length) entries = filtered;
  }

  if (!entries.length) {
    const dispatches = (run.dispatches ?? []).map((dispatch) => ({
      at: dispatch.lastEventAt,
      label: dispatch.lastEventType ?? "Dispatch event",
      status: dispatch.error ? "bad" : "neutral",
      detail: dispatch.error ?? dispatch.stage ?? "",
    }));
    if (!dispatches.length) {
      return '<p class="empty">No structured timeline events for this selection.</p>';
    }
    entries = dispatches;
  }

  return (
    '<ul class="timeline-list">' +
    entries
      .map((entry) => {
        const cls = tagClass(entry.status);
        return (
          '<li><div class="timeline-time">' +
          (entry.at ? esc(entry.at) : "—") +
          '</div><div><span class="tag ' +
          cls +
          '">' +
          esc(entry.label) +
          "</span> " +
          (entry.detail ? esc(entry.detail) : "") +
          (entry.issue ? " · " + esc(entry.issue) : "") +
          "</div></li>"
        );
      })
      .join("") +
    "</ul>"
  );
};

const renderLogs = (status) => {
  const run = state.selectedRunId
    ? status.runs.find((entry) => entry.runId === state.selectedRunId)
    : status.runs[0];
  if (!run) {
    el("logs-context").textContent = "";
    return '<p class="empty">No log excerpts available.</p>';
  }

  el("logs-context").textContent =
    "Run " + run.runId.slice(0, 8) + " · " + run.command + " · redacted excerpts from events.jsonl";

  const rows = run.logRows?.length ? run.logRows : (run.logExcerpt ?? []).map((line) => ({
    timestamp: "—",
    type: "log",
    severity: "info",
    message: line,
  }));

  if (!rows.length) return '<p class="empty">No log lines recorded for this run.</p>';

  return (
    '<table class="log-table"><thead><tr><th>Time</th><th>Type</th><th>Issue</th><th>Severity</th><th>Message</th></tr></thead><tbody>' +
    rows
      .map((row) => {
        const sevClass = row.severity === "error" ? "log-sev-error" : row.severity === "warn" ? "log-sev-warn" : "log-sev-info";
        return (
          '<tr><td data-label="Time">' +
          esc(row.timestamp) +
          '</td><td data-label="Type">' +
          esc(row.type) +
          '</td><td data-label="Issue">' +
          esc(row.issue ?? "—") +
          '</td><td data-label="Severity" class="' +
          sevClass +
          '">' +
          esc(row.severity) +
          '</td><td data-label="Message">' +
          esc(row.message) +
          "</td></tr>"
        );
      })
      .join("") +
    "</tbody></table>"
  );
};

const ensureSelection = (status) => {
  if (state.selectedIssueId && !findIssue(status, state.selectedIssueId)) {
    state.selectedIssueId = status.issues[0]?.id ?? null;
  }
  if (!state.selectedIssueId && status.issues[0]) {
    state.selectedIssueId = status.issues[0].id;
  }
  if (state.selectedRunId && !status.runs.some((run) => run.runId === state.selectedRunId)) {
    state.selectedRunId = status.runs[0]?.runId ?? null;
  }
  if (!state.selectedRunId && status.runs[0]) {
    state.selectedRunId = status.runs[0].runId;
  }
};

const bindSelectionHandlers = () => {
  document.querySelectorAll(".issue-row").forEach((node) => {
    node.addEventListener("click", () => {
      state.selectedIssueId = node.getAttribute("data-issue-id");
      render(state.status);
    });
  });
  document.querySelectorAll(".run-row").forEach((node) => {
    node.addEventListener("click", () => {
      state.selectedRunId = node.getAttribute("data-run-id");
      render(state.status);
    });
  });
};

const render = (status) => {
  state.status = status;
  ensureSelection(status);

  const repo = status.repository;
  el("generated-at").textContent = "Updated " + status.generatedAt;
  el("scan-source").innerHTML =
    scanBadge(status.scan.source) +
    (status.scan.scannedAt ? " @ " + esc(status.scan.scannedAt) : "");
  el("repo-meta").textContent = repo
    ? repo.remoteUrl + " @ " + repo.baseBranch + " (" + repo.baseSha.slice(0, 8) + ")"
    : "No repository context from runs yet";

  el("queue-panel").innerHTML = renderQueue(status);
  el("detail-panel").innerHTML = renderDetail(status);
  el("bouts-panel").innerHTML = renderBouts(status.bouts);
  el("runs-panel").innerHTML = renderRuns(status.runs);
  el("timeline-panel").innerHTML = renderTimeline(status);
  el("logs-panel").innerHTML = renderLogs(status);

  bindSelectionHandlers();
};

const load = async () => {
  el("error-banner").hidden = true;
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("status " + response.status);
    }
    render(await response.json());
  } catch (error) {
    el("error-banner").hidden = false;
    el("error-banner").textContent = "Failed to load dashboard: " + error;
  }
};

el("refresh").addEventListener("click", load);
load();
setInterval(load, 5000);
`;
