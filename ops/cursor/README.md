# Cursor Ops

This directory holds host-side Cursor launch experiments for Tarmac.

The active path is the current Cursor TypeScript SDK (`@cursor/sdk`) and Cursor
Cloud Agents. Older REST examples using `/v0/agents` are historical only and
must not be used as a base for Tarmac.

## Boundaries

- `CURSOR_API_KEY` is host-only and must stay in `ops/cursor/.env` or the host
  environment.
- FP REST credentials are passed to Cursor workers through Cursor-managed
  secrets or another documented non-prompt environment mechanism, never
  committed files. Full E2E is blocked until this mechanism is proven.
- The worker runs `fp` from a non-repo directory with `FP_REMOTE=rest-api`.
- The durable artifact is a Cursor-created GitHub PR plus `tarmac_*` FP metadata
  for the first demo.

## Environment Bootstrap

Cursor starts cloud workers from a base environment and then runs the repository
install command from `.cursor/environment.json`. Tarmac's install command is:

```bash
sh ops/cursor/bootstrap-env.sh
```

The script is intentionally checked in instead of inlined in JSON. It installs
or exposes Bun first, runs `bun install --frozen-lockfile`, installs
REST-capable `fp` `0.24.0-next.85d878d` into `$HOME/.fiberplane/bin`, updates
`PATH` in the current install shell, exposes both CLIs through the base `PATH`
for later worker shells, and checks `bun --version` plus `fp --version`. It must
stay idempotent because Cursor may reuse or refresh cached environments. Set
`FP_VERSION` before bootstrap only when the pinned REST-capable version needs to
change.

To reproduce a missing-Bun base image locally without using local shell
profiles:

```bash
rm -rf /tmp/tarmac-cursor-home
mkdir -p /tmp/tarmac-cursor-home/bin
env -i HOME=/tmp/tarmac-cursor-home PATH=/tmp/tarmac-cursor-home/bin:/usr/bin:/bin sh ops/cursor/bootstrap-env.sh
```

The script may print tool versions and installer diagnostics. Do not add token
values or secret-dependent commands to this bootstrap path.

## References

- Cursor Cloud Agent docs: https://cursor.com/docs/cloud-agent
- Cursor Cloud Agent API: https://cursor.com/docs/cloud-agent/api/endpoints
- Cursor SDK docs: https://cursor.com/docs/api/sdk/typescript
- Cursor SDK package: `@cursor/sdk@1.0.13`
- Local upstream clone: `references/cursor-cookbook`
