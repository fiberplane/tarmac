#!/usr/bin/env bash
# Pre-commit: run oxlint on staged JS/TS files only.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

STAGED=()
while IFS= read -r -d '' path; do
	STAGED+=("$path")
done < <(
	git diff --cached --name-only --diff-filter=ACMR -z -- \
		'*.js' '*.jsx' '*.ts' '*.tsx' '*.cjs' '*.mjs'
)

if [ "${#STAGED[@]}" -eq 0 ]; then
	exit 0
fi

OXLINT="$REPO_ROOT/node_modules/.bin/oxlint"
if [ ! -x "$OXLINT" ]; then
	if command -v oxlint >/dev/null 2>&1; then
		OXLINT="oxlint"
	else
		echo "[oxlint-staged] oxlint not found. Run 'bun install' at the repo root."
		exit 1
	fi
fi

exec "$OXLINT" "${STAGED[@]}"
