#!/usr/bin/env sh
set -eu

BASE_PATH="$PATH"

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

run_as_root() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
    return
  fi

  require_command sudo
  sudo "$@"
}

base_path_has_command() {
  PATH="$BASE_PATH" command -v "$1" >/dev/null 2>&1
}

expose_on_base_path() {
  name="$1"
  source_path="$2"

  if base_path_has_command "$name"; then
    log "$name already available on base PATH"
    return
  fi

  old_ifs="$IFS"
  IFS=:
  for dir in $BASE_PATH; do
    IFS="$old_ifs"
    if [ ! -d "$dir" ]; then
      IFS=:
      continue
    fi

    target="$dir/$name"
    log "Exposing $name at $target"
    if [ -w "$dir" ]; then
      ln -sf "$source_path" "$target"
    else
      run_as_root ln -sf "$source_path" "$target"
    fi

    if PATH="$BASE_PATH" command -v "$name" >/dev/null 2>&1; then
      IFS="$old_ifs"
      return
    fi
    IFS=:
  done
  IFS="$old_ifs"

  fail "$name could not be exposed on the base PATH for later worker shells"
}

install_linux_unzip_if_needed() {
  if [ "$(uname -s)" != "Linux" ] || command -v unzip >/dev/null 2>&1; then
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    log "Installing unzip for Bun installer"
    run_as_root apt-get update
    run_as_root apt-get install -y unzip
    return
  fi

  fail "unzip is required to install Bun on Linux"
}

install_bun_if_needed() {
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if command -v bun >/dev/null 2>&1; then
    log "Bun already available"
    expose_on_base_path bun "$(command -v bun)"
    return
  fi

  require_command curl
  require_command bash
  install_linux_unzip_if_needed

  log "Installing Bun"
  curl -fsSL https://bun.com/install | bash
  export PATH="$BUN_INSTALL/bin:$PATH"
  expose_on_base_path bun "$BUN_INSTALL/bin/bun"
}

install_fp() {
  export FP_INSTALL_DIR="${FP_INSTALL_DIR:-$HOME/.fiberplane/bin}"
  export PATH="$FP_INSTALL_DIR:$PATH"

  require_command curl
  require_command tar

  log "Installing fp CLI"
  curl -fsSL https://setup.fp.dev/install.sh | sh -s -- --install-dir "$FP_INSTALL_DIR"
  export PATH="$FP_INSTALL_DIR:$PATH"
  expose_on_base_path fp "$FP_INSTALL_DIR/fp"
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
