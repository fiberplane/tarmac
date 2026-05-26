#!/usr/bin/env bash
# Pre-commit: run ast-grep on staged TS/TSX files only.
#
# Uses the repo-root sgconfig.yml so the same rules CI enforces apply here.
# No staged TS/TSX files => no-op.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

STAGED=()
while IFS= read -r -d '' path; do
	STAGED+=("$path")
done < <(
	git diff --cached --name-only --diff-filter=ACMR -z -- '*.ts' '*.tsx'
)

if [ "${#STAGED[@]}" -eq 0 ]; then
	exit 0
fi

# Prefer the root-installed binary (ast-grep is a root devDependency).
AST_GREP="$REPO_ROOT/node_modules/.bin/ast-grep"
if [ ! -x "$AST_GREP" ]; then
	if command -v ast-grep >/dev/null 2>&1; then
		AST_GREP="ast-grep"
	else
		echo "[ast-grep-staged] ast-grep not found. Run 'bun install' at the repo root."
		exit 1
	fi
fi

exec "$AST_GREP" scan -c "$REPO_ROOT/sgconfig.yml" "${STAGED[@]}"
