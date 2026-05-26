#!/usr/bin/env bash
# Verify the local git version supports config-based hooks (>= 2.54).
#
# Usage: .githooks/check-git-version.sh

set -euo pipefail

REQUIRED_MAJOR=2
REQUIRED_MINOR=54

version_line="$(git --version)"
# Strip everything but the X.Y.Z core (handles "git version 2.54.1 (Apple Git-...)").
version="${version_line#git version }"
version="${version%% *}"

IFS=. read -r major minor _patch <<<"$version"
major="${major:-0}"
minor="${minor:-0}"

if [ "$major" -gt "$REQUIRED_MAJOR" ] || \
	{ [ "$major" -eq "$REQUIRED_MAJOR" ] && [ "$minor" -ge "$REQUIRED_MINOR" ]; }; then
	echo "git $version — OK (>= ${REQUIRED_MAJOR}.${REQUIRED_MINOR})"
	exit 0
fi

cat <<EOF >&2
git $version is too old for config-based hooks (need >= ${REQUIRED_MAJOR}.${REQUIRED_MINOR}).

Upgrade:
  Ubuntu/Debian:
    sudo add-apt-repository -y ppa:git-core/ppa
    sudo apt update && sudo apt install -y git

  macOS (Homebrew):
    brew install git    # or 'brew upgrade git' if already installed
    # Ensure Homebrew's bin comes before /usr/bin in PATH — Apple's
    # /usr/bin/git is an older fork. Check with: which -a git
EOF
exit 1
