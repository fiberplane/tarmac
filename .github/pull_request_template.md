## Summary

<!-- What changed and why. Link the fp issue when applicable. -->

- **Issue:** <!-- e.g. TARM-xxxxx -->

## Verification

<!-- Commands you ran (e.g. bun run test, bun run format:check, bun run check). -->

## Thermo-nuclear code quality review

Complete this section before opening or updating the PR. It is a **human/agent attestation**, not an automated CI gate — `bun run check`, lint, drift, and other workflows enforce machine-checked rules separately.

Run the vendored skill:

- `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md`
- `.cursor/skills/thermo-nuclear-code-quality-review/SKILL.md` (same content)

### Checklist

- [ ] I ran the thermo-nuclear review on this branch's diff (or I explain below why I did not).
- [ ] I addressed material findings or documented why each was accepted, rejected, or deferred.

### Outcome

| Ran review?                 | What it found                                                                                                                                                                      | Disposition                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| <!-- Yes / No / Partial --> | <!-- structural regressions; files crossing ~1k lines; spaghetti branching or scattered conditionals; type-boundary smells; logic in the wrong layer; unnecessary abstractions --> | <!-- fixed / accepted with reason / deferred with reason --> |

### Residual risks

<!-- Optional: known maintainability debt you are intentionally shipping. -->
