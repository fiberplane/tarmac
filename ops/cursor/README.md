# Cursor Ops

This directory holds host-side Cursor launch experiments for Tarmac.

The active path is the current Cursor TypeScript SDK (`@cursor/sdk`) and Cursor
Cloud Agents. Older REST examples using `/v0/agents` are historical only and
must not be used as a base for Tarmac.

## Boundaries

- `CURSOR_API_KEY` is host-only and must stay in `ops/cursor/.env` or the host
  environment.
- FP REST credentials are passed to Cursor workers through Cursor-managed
  secrets or per-run environment support, never committed files.
- The worker runs `fp` from a non-repo directory with `FP_REMOTE=rest-api`.
- The durable artifact is a GitHub PR plus `tarmac_*` FP metadata.

## References

- Cursor Cloud Agent docs: https://cursor.com/docs/cloud-agent
- Cursor Cloud Agent API: https://cursor.com/docs/cloud-agent/api/endpoints
- Cursor SDK docs: https://cursor.com/docs/api/sdk/typescript
- Cursor SDK package: `@cursor/sdk@1.0.13`
- Local upstream clone: `references/cursor-cookbook`
