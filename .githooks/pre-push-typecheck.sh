#!/usr/bin/env bash
# Pre-push (opt-in): full-repo typecheck.
#
# Wired in by `git config --local --add include.path
# ../../.githooks/hooks-typecheck.gitconfig`. Slower than the default hooks
# (~30s) — opt in if you want extra safety before pushing.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Intentionally ignores pre-push stdin (the ref-update list). We typecheck
# the working tree, not the specific commits being pushed.
exec bun typecheck
