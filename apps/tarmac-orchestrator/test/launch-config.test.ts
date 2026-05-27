import { describe, expect, test } from "bun:test";

import {
  buildCursorWorkerEnv,
  buildHostSecretRedaction,
  MissingCursorWorkerEnvError,
  parseCursorMode,
} from "../src";

describe("launch config", () => {
  test("fake mode does not construct Cursor worker env", () => {
    expect(buildCursorWorkerEnv("fake", {})).toBeUndefined();
  });

  test("real mode fails closed when FP REST env is missing", () => {
    expect(() => buildCursorWorkerEnv("real", {})).toThrow(MissingCursorWorkerEnvError);
  });

  test("real mode passes only supported FP env names to Cursor", () => {
    expect(
      buildCursorWorkerEnv("real", {
        FP_TOKEN: "token",
        FP_WORKSPACE: "workspace",
        FP_PROJECT_ID: "project",
        FP_SERVER_URL: "https://console.example",
        FP_PROJECT_PREFIX: "TARM",
        CURSOR_API_KEY: "cursor-secret",
      }),
    ).toEqual({
      FP_REMOTE: "rest-api",
      FP_TOKEN: "token",
      FP_WORKSPACE: "workspace",
      FP_PROJECT_ID: "project",
      FP_SERVER_URL: "https://console.example",
      FP_PROJECT_PREFIX: "TARM",
    });
  });

  test("parses Cursor mode strictly", () => {
    expect(parseCursorMode(undefined)).toBe("real");
    expect(parseCursorMode("fake")).toBe("fake");
    expect(parseCursorMode("real")).toBe("real");
    expect(parseCursorMode("other")).toBeUndefined();
  });

  test("builds host secret redaction without sending host secrets to workers", () => {
    expect(
      buildHostSecretRedaction({
        CURSOR_API_KEY: "cursor-secret",
      }),
    ).toEqual({
      secrets: [
        {
          name: "CURSOR_API_KEY",
          value: "cursor-secret",
        },
        {
          name: "GITHUB_TOKEN",
        },
        {
          name: "GH_TOKEN",
        },
        {
          name: "GITHUB_PAT",
        },
      ],
    });
  });
});
