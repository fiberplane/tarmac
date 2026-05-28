import type { PromptRedactionConfig } from "@tarmac/worker-prompt";

import { FpCliClient } from "../fp-client";
import { buildHostSecretRedaction } from "../launch-config";
import { resolveStateRoot } from "../local-state";
import { dashboardJs } from "./client";
import { buildDashboardStatus } from "./status";
import { dashboardCss } from "./styles";
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

export { dashboardCss, dashboardJs };
