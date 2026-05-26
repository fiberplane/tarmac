# Local git hooks

Tracked, opt-in, config-based git hooks for tarmac. They mirror the
cheapest checks CI runs (oxlint, ast-grep, drift) so failures surface
client-side instead of after a push.

These use git 2.54's [config-based hooks][2.54], not `core.hooksPath`. The
upshot is that they live in tracked files (this directory) rather than
`.git/hooks/`, so they work from every worktree once you wire them in.

[2.54]: https://github.blog/open-source/git/highlights-from-git-2-54/

## Requirements

Git **2.54 or newer**. Check yours:

```sh
.githooks/check-git-version.sh
```

### Ubuntu / Debian

Apt ships an older git. Use the upstream PPA:

```sh
sudo add-apt-repository -y ppa:git-core/ppa
sudo apt update && sudo apt install -y git
```

### macOS (Homebrew)

```sh
brew install git    # or: brew upgrade git
```

macOS also ships `/usr/bin/git` (Apple's older fork), so make sure
Homebrew's bin comes first in `PATH`:

```sh
which -a git    # should list /opt/homebrew/bin/git (or /usr/local/bin/git) first
```

If the system git wins, prepend Homebrew to your shell rc, e.g.:

```sh
echo 'export PATH="/opt/homebrew/bin:$PATH"' >> ~/.zshrc
```

## Wiring the hooks in

Run this **once per clone**, from inside any worktree:

```sh
git config --local include.path "$(git rev-parse --show-toplevel)/.githooks/hooks.gitconfig"
```

`git config --local` writes to the shared common config (`.git/config` in
the main worktree), so a single setup applies across every worktree of
this clone. Each worktree still runs its own copy of the hook scripts:
when a hook fires, git sets CWD to that worktree's root, and the
`command = .githooks/…` paths resolve relative to it.

If you want each worktree to be able to enable/disable hooks
independently, opt into per-worktree config and use `--worktree` instead:

```sh
git config --local extensions.worktreeConfig true   # one-time, on the main worktree
git config --worktree include.path "$(git rev-parse --show-toplevel)/.githooks/hooks.gitconfig"
```

Verify either way:

```sh
git hook list pre-commit
git hook list pre-push
```

You should see `oxlint-staged` and `ast-grep-staged` on `pre-commit`, and
`drift-lint` on `pre-push`.

## What runs when

| Event      | Hook            | What it does                                                     |
| ---------- | --------------- | ---------------------------------------------------------------- |
| pre-commit | oxlint-staged   | Runs `oxlint` on staged JS/TS files. No-op if none staged.       |
| pre-commit | ast-grep-staged | Runs `ast-grep scan -c sgconfig.yml` on staged `.ts`/`.tsx`.     |
| pre-push   | drift-lint      | Runs `drift lint`. Skips with a hint if `drift` isn't installed. |

These are deliberately fast — they only see files you actually staged, so
edits to unrelated parts of the repo don't slow you down.

## Disabling and bypassing

Disable one hook locally without touching the tracked config:

```sh
git config hook.oxlint-staged.enabled false
```

Re-enable:

```sh
git config --unset hook.oxlint-staged.enabled
```

Skip all hooks for one commit / push:

```sh
git commit --no-verify
git push --no-verify
```

Use `--no-verify` sparingly — if a hook is too noisy to live with,
disable it explicitly so it's obvious you've opted out.

## Stretch: opt-in pre-push typecheck

Full-repo `bun typecheck` is too slow to run by default (~30s on a warm
cache), but you can opt into it:

```sh
git config --local --add include.path \
  "$(git rev-parse --show-toplevel)/.githooks/hooks-typecheck.gitconfig"
```

Disable later:

```sh
git config --local --unset include.path \
  "$(git rev-parse --show-toplevel)/.githooks/hooks-typecheck.gitconfig"
```

(`git config --local --get-all include.path` lists everything currently
included — handy if the exact string you stored has slipped your mind.)

## Files in this directory

| File                        | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `hooks.gitconfig`           | Default hook set (oxlint, ast-grep, drift).           |
| `hooks-typecheck.gitconfig` | Opt-in pre-push typecheck.                            |
| `staged-oxlint.sh`          | Wrapper: oxlint on staged files only.                 |
| `staged-astgrep.sh`         | Wrapper: ast-grep on staged TS/TSX only.              |
| `pre-push-drift.sh`         | Wrapper: drift lint (skips cleanly if drift missing). |
| `pre-push-typecheck.sh`     | Wrapper: full `bun typecheck`.                        |
| `check-git-version.sh`      | Verifies your git is >= 2.54.                         |
