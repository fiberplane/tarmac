import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const templatePath = join(import.meta.dir, "../../.github/pull_request_template.md");

describe("pull request template", () => {
  test("prompts authors for thermo-nuclear review evidence and distinguishes CI", () => {
    const template = readFileSync(templatePath, "utf8");

    expect(template).toContain("thermo-nuclear-code-quality-review");
    expect(template).toMatch(/not an automated CI gate|not a CI gate|human\/agent/i);
    expect(template).toMatch(/ran the thermo-nuclear|ran.*thermo-nuclear/i);
    expect(template).toMatch(
      /structural|file.?size|spaghetti|type.?boundar|wrong.?layer|abstraction/i,
    );
  });
});
