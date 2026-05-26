import { describe, expect, test } from "bun:test";

import { formatRestEnv, parseRemoteProjectJson, redactTokenInText } from "./rest-env-from-remote";

describe("parseRemoteProjectJson", () => {
  test("maps canonical fp project remote fields", () => {
    expect(
      parseRemoteProjectJson(
        JSON.stringify({
          workspaceSlug: "acme",
          projectId: "proj_01TEST",
          serverUrl: "https://api.example.test",
          prefix: "TARM",
        }),
      ),
    ).toEqual({
      FP_REMOTE: "rest",
      FP_WORKSPACE: "acme",
      FP_PROJECT_ID: "proj_01TEST",
      FP_SERVER_URL: "https://api.example.test",
      FP_PROJECT_PREFIX: "TARM",
    });
  });

  test("accepts alternate field names", () => {
    expect(
      parseRemoteProjectJson(
        JSON.stringify({
          workspace: "acme",
          id: "proj_alt",
          apiUrl: "https://api.alt.test",
        }),
      ),
    ).toEqual({
      FP_REMOTE: "rest",
      FP_WORKSPACE: "acme",
      FP_PROJECT_ID: "proj_alt",
      FP_SERVER_URL: "https://api.alt.test",
    });
  });

  test("throws when required remote fields are missing", () => {
    expect(() => parseRemoteProjectJson(JSON.stringify({ workspace: "acme" }))).toThrow(
      /missing required fields/i,
    );
  });
});

describe("formatRestEnv", () => {
  const values = {
    FP_REMOTE: "rest",
    FP_WORKSPACE: "acme",
    FP_PROJECT_ID: "proj_01TEST",
    FP_SERVER_URL: "https://api.example.test",
    FP_PROJECT_PREFIX: "TARM",
  } as const;

  test("redacts token by default", () => {
    const output = formatRestEnv(values);
    expect(output).toContain("FP_TOKEN=<redacted>");
    expect(output).not.toContain("secret-token");
  });

  test("prints shell exports without token unless include-token is set", () => {
    const output = formatRestEnv(values, { shell: true });
    expect(output).toContain("export FP_WORKSPACE=acme");
    expect(output).toMatch(/FP_TOKEN: export manually/);
  });

  test("includes token only when explicitly requested", () => {
    const output = formatRestEnv(values, {
      includeToken: true,
      tokenFromEnv: "secret-token",
      shell: true,
    });
    expect(output).toContain("export FP_TOKEN=secret-token");
  });
});

describe("redactTokenInText", () => {
  test("replaces accidental token leaks", () => {
    expect(redactTokenInText("value=abc123", "abc123")).toBe("value=<redacted>");
  });
});
