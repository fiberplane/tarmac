#!/usr/bin/env bash
# Pre-push: run drift lint to catch spec-to-code drift before CI does.
#
# If the drift binary is not installed, print the install one-liner and
# exit 0 — we don't want missing tooling to block a push.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if ! command -v drift >/dev/null 2>&1; then
	cat <<'EOF'
[drift-lint] drift binary not found on PATH — skipping.
[drift-lint] Install with:
[drift-lint]   curl -fsSL https://drift.fp.dev/install.sh | sh
EOF
	exit 0
fi

exec drift lint
