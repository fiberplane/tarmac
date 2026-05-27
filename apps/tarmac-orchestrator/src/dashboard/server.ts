import type { PromptRedactionConfig } from "@tarmac/worker-prompt";

import { FpCliClient } from "../fp-client";
import { buildHostSecretRedaction } from "../launch-config";
import { resolveStateRoot } from "../local-state";
import { buildDashboardStatus } from "./status";
import type { DashboardServerOptions, DashboardStatus } from "./types";
import { dashboardHtml } from "./ui";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

export type CreateDashboardServerOptions = DashboardServerOptions & {
  readonly redaction?: PromptRedactionConfig;
};

export const createDashboardHandlers = (options: CreateDashboardServerOptions) => {
  const redaction = options.redaction ?? buildHostSecretRedaction();
  const stateRoot = options.stateRoot;

  const loadStatus = async (): Promise<DashboardStatus> =>
    buildDashboardStatus({
      stateRoot,
      redaction,
      runLimit: options.runLimit,
      eventLimit: options.eventLimit,
      ...(options.liveScan
        ? {
            fpClient: new FpCliClient(options.cwd),
          }
        : {}),
    });

  return {
    loadStatus,
    handleRequest: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);

      if (url.pathname === "/api/status") {
        try {
          return jsonResponse(200, await loadStatus());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return jsonResponse(500, { error: message });
        }
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(dashboardHtml, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      if (url.pathname === "/dashboard.css") {
        return new Response(dashboardCss, {
          status: 200,
          headers: {
            "content-type": "text/css; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      if (url.pathname === "/dashboard.js") {
        return new Response(dashboardJs, {
          status: 200,
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      return jsonResponse(404, { error: "not found" });
    },
  };
};

export const startDashboardServer = (options: CreateDashboardServerOptions) => {
  const handlers = createDashboardHandlers(options);

  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    fetch: handlers.handleRequest,
  });

  return {
    server,
    url: `http://${options.host}:${server.port}`,
    handlers,
  };
};

export const resolveDashboardOptions = (
  cwd: string,
  flags: ReadonlyMap<string, string | true>,
): DashboardServerOptions => {
  const host = typeof flags.get("host") === "string" ? (flags.get("host") as string) : "127.0.0.1";
  const portRaw =
    typeof flags.get("port") === "string" ? Number.parseInt(flags.get("port") as string, 10) : 3847;
  const runLimitRaw =
    typeof flags.get("run-limit") === "string"
      ? Number.parseInt(flags.get("run-limit") as string, 10)
      : 10;
  const eventLimitRaw =
    typeof flags.get("event-limit") === "string"
      ? Number.parseInt(flags.get("event-limit") as string, 10)
      : 50;

  return {
    host,
    port: Number.isFinite(portRaw) ? portRaw : 3847,
    cwd,
    stateRoot:
      typeof flags.get("state-root") === "string"
        ? (flags.get("state-root") as string)
        : resolveStateRoot(cwd),
    runLimit: Number.isFinite(runLimitRaw) ? runLimitRaw : 10,
    eventLimit: Number.isFinite(eventLimitRaw) ? eventLimitRaw : 50,
    liveScan: !flags.has("no-live-scan"),
  };
};

const dashboardCss = `
:root {
  color-scheme: light dark;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.4;
  --border: color-mix(in srgb, CanvasText 20%, transparent);
  --muted: color-mix(in srgb, CanvasText 65%, transparent);
  --ok: #1a7f37;
  --warn: #9a6700;
  --bad: #cf222e;
  --panel: color-mix(in srgb, Canvas 92%, CanvasText 8%);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0.75rem;
  background: Canvas;
  color: CanvasText;
}
header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.5rem;
}
h1 { font-size: 1rem; margin: 0; }
h2 { font-size: 0.85rem; margin: 0 0 0.4rem; text-transform: uppercase; letter-spacing: 0.04em; }
.meta { color: var(--muted); font-size: 0.75rem; }
button {
  font: inherit;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--border);
  background: var(--panel);
  cursor: pointer;
}
.grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
}
.panel {
  border: 1px solid var(--border);
  background: var(--panel);
  padding: 0.5rem;
  min-width: 0;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  text-align: left;
  vertical-align: top;
  padding: 0.15rem 0.25rem;
  border-bottom: 1px solid var(--border);
  word-break: break-word;
}
th { color: var(--muted); font-weight: 600; }
.tag {
  display: inline-block;
  padding: 0 0.25rem;
  border: 1px solid var(--border);
  border-radius: 0.2rem;
  font-size: 0.7rem;
}
.tag.ok { color: var(--ok); }
.tag.warn { color: var(--warn); }
.tag.bad { color: var(--bad); }
a { color: inherit; }
.run-card { margin-bottom: 0.5rem; }
.run-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.75rem;
  align-items: baseline;
}
.log {
  white-space: pre-wrap;
  font-size: 0.72rem;
  max-height: 10rem;
  overflow: auto;
  margin: 0.35rem 0 0;
  padding: 0.35rem;
  border: 1px solid var(--border);
  background: Canvas;
}
.bout { margin-bottom: 0.5rem; }
.bout ul { margin: 0.2rem 0 0; padding-left: 1rem; }
.empty { color: var(--muted); font-style: italic; }
.error-banner {
  border: 1px solid var(--bad);
  color: var(--bad);
  padding: 0.35rem 0.5rem;
  margin-bottom: 0.75rem;
}
@media (max-width: 40rem) {
  body { padding: 0.5rem; }
  .grid { grid-template-columns: 1fr; }
}
`;

const dashboardJs = `
const el = (id) => document.getElementById(id);

const esc = (value) => {
  if (value === undefined || value === null) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
};

const issueLabel = (issue) => esc(issue.displayId ?? issue.id);

const link = (href, label) => {
  if (!href) return esc(label ?? "");
  return '<a href="' + esc(href) + '" target="_blank" rel="noreferrer">' + esc(label ?? href) + "</a>";
};

const reasonText = (reason) => {
  if (!reason) return "";
  if (reason.kind === "blocked-by-dependency") return "blocked by " + esc(reason.dependencyId);
  if (reason.kind === "blocked-by-open-child") return "blocked by child " + esc(reason.childId);
  if (reason.kind === "not-todo") return "status " + esc(reason.status);
  return esc(reason.kind);
};

const renderScan = (scan) => {
  const rows = [
    ...scan.eligible.map((issue) => ({
      issue,
      kind: "eligible",
      reason: "",
    })),
    ...scan.ineligible.map((entry) => ({
      issue: entry.issue,
      kind: "ineligible",
      reason: reasonText(entry.reason),
    })),
  ];

  if (rows.length === 0) {
    return '<p class="empty">No scan data yet.</p>';
  }

  return (
    '<table><thead><tr><th>Issue</th><th>Eligibility</th><th>Reason</th><th>Links</th></tr></thead><tbody>' +
    rows
      .map((row) => {
        const t = row.issue.tarmac ?? {};
        const links = [
          t.cursorUrl ? link(t.cursorUrl, "Cursor") : "",
          t.prUrl ? link(t.prUrl, "PR" + (t.prNumber ? " #" + esc(t.prNumber) : "")) : "",
        ]
          .filter(Boolean)
          .join(" · ");
        const tagClass = row.kind === "eligible" ? "ok" : "bad";
        return (
          "<tr><td>" +
          issueLabel(row.issue) +
          "</td><td><span class=\\"tag " +
          tagClass +
          '\\">' +
          esc(row.kind) +
          "</span></td><td>" +
          row.reason +
          "</td><td>" +
          (links || "—") +
          "</td></tr>"
        );
      })
      .join("") +
    "</tbody></table>"
  );
};

const renderBouts = (bouts) => {
  if (!bouts.length) return '<p class="empty">No parent/child bouts.</p>';
  return bouts
    .map((bout) => {
      const children = bout.children
        .map((child) => {
          const t = child.tarmac ?? {};
          const bits = [
            child.eligibility?.kind === "ineligible" ? reasonText(child.eligibility.reason) : "",
            t.lastError ? "error: " + esc(t.lastError) : "",
            t.cursorUrl ? link(t.cursorUrl, "Cursor") : "",
            t.prUrl ? link(t.prUrl, "PR") : "",
          ].filter(Boolean);
          return "<li>" + issueLabel(child) + (bits.length ? " — " + bits.join(" · ") : "") + "</li>";
        })
        .join("");
      return (
        '<div class="bout"><strong>' +
        issueLabel(bout.parent) +
        "</strong> · " +
        esc(bout.parent.title ?? "") +
        "<ul>" +
        children +
        "</ul></div>"
      );
    })
    .join("");
};

const renderRuns = (runs) => {
  if (!runs.length) return '<p class="empty">No local runs recorded.</p>';
  return runs
    .map((run) => {
      const summary = run.summary ?? {};
      const dispatches = (run.dispatches ?? [])
        .map((dispatch) => {
          const bits = [
            dispatch.cursorUrl ? link(dispatch.cursorUrl, "Cursor") : "",
            dispatch.prUrl ? link(dispatch.prUrl, "PR") : "",
            dispatch.error ? '<span class="tag bad">' + esc(dispatch.error) + "</span>" : "",
          ].filter(Boolean);
          return "<li>" + issueLabel(dispatch.issue) + (bits.length ? " — " + bits.join(" · ") : "") + "</li>";
        })
        .join("");
      const statusClass = run.status === "failed" ? "bad" : run.status === "running" ? "warn" : "ok";
      return (
        '<div class="run-card"><div class="run-head"><strong>' +
        esc(run.command) +
        '</strong><span class="tag ' +
        statusClass +
        '">' +
        esc(run.status) +
        '</span><span class="meta">' +
        esc(run.runId.slice(0, 8)) +
        " · " +
        esc(run.startedAt) +
        (run.finishedAt ? " → " + esc(run.finishedAt) : "") +
        "</span></div>" +
        (summary.error ? '<div class="tag bad">' + esc(summary.error) + "</div>" : "") +
        (dispatches ? "<ul>" + dispatches + "</ul>" : "") +
        (run.logExcerpt?.length
          ? '<pre class="log">' + run.logExcerpt.map(esc).join("\\n") + "</pre>"
          : "") +
        "</div>"
      );
    })
    .join("");
};

const render = (status) => {
  const repo = status.repository;
  el("generated-at").textContent = "Updated " + status.generatedAt;
  el("scan-source").textContent = "Scan: " + status.scan.source + (status.scan.scannedAt ? " @ " + status.scan.scannedAt : "");
  el("repo-meta").textContent = repo
    ? repo.remoteUrl + " @ " + repo.baseBranch + " (" + repo.baseSha.slice(0, 8) + ")"
    : "No repository context from runs yet";
  el("scan-panel").innerHTML = renderScan(status.scan);
  el("bouts-panel").innerHTML = renderBouts(status.bouts);
  el("runs-panel").innerHTML = renderRuns(status.runs);
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

export { dashboardCss, dashboardJs };
