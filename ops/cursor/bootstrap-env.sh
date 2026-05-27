#!/usr/bin/env sh
set -eu

log() {
  printf '%s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required for Cursor bootstrap"
}

install_linux_unzip_if_needed() {
  if [ "$(uname -s)" != "Linux" ] || command -v unzip >/dev/null 2>&1; then
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    log "Installing unzip for Bun installer"
    if [ "$(id -u)" = "0" ]; then
      apt-get update
      apt-get install -y unzip
    else
      require_command sudo
      sudo apt-get update
      sudo apt-get install -y unzip
    fi
    return
  fi

  fail "unzip is required to install Bun on Linux"
}

install_bun_if_needed() {
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if command -v bun >/dev/null 2>&1; then
    log "Bun already available"
    return
  fi

  require_command curl
  require_command bash
  install_linux_unzip_if_needed

  log "Installing Bun"
  curl -fsSL https://bun.com/install | bash
  export PATH="$BUN_INSTALL/bin:$PATH"
}

install_fp() {
  export FP_INSTALL_DIR="${FP_INSTALL_DIR:-$HOME/.fiberplane/bin}"
  export PATH="$FP_INSTALL_DIR:$PATH"

  require_command curl
  require_command tar

  log "Installing fp CLI"
  curl -fsSL https://setup.fp.dev/install.sh | sh -s -- --install-dir "$FP_INSTALL_DIR"
  export PATH="$FP_INSTALL_DIR:$PATH"
}

verify_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 was not found after bootstrap"
  version="$("$1" --version)" || fail "$1 --version failed after bootstrap"
  log "$1 version: $version"
}

install_bun_if_needed
verify_command bun

log "Installing workspace dependencies"
bun install --frozen-lockfile

install_fp
verify_command fp

log "Cursor bootstrap completed"
