#!/bin/sh
# Generic mise launcher for minimal shells (git hooks, CI, agent sandboxes)
# where mise may not be on PATH.
#
# Resolution order: $MISE_BIN, then `command -v mise`, then the standard
# per-user install at $HOME/.local/bin/mise. All arguments are forwarded to
# mise unchanged, e.g.:
#
#   scripts/mise-exec.sh run gate
#
# This script only locates the mise executable. Quality command definitions
# live in mise.toml — do not add them here.
set -eu

if [ -n "${MISE_BIN:-}" ]; then
  mise_bin=$MISE_BIN
elif command -v mise >/dev/null 2>&1; then
  mise_bin=$(command -v mise)
elif [ -x "$HOME/.local/bin/mise" ]; then
  mise_bin=$HOME/.local/bin/mise
else
  printf '%s\n' "error: mise executable not found (looked at \$MISE_BIN, PATH, and \$HOME/.local/bin/mise)." >&2
  printf '%s\n' "Install mise (https://mise.jdx.dev/getting-started.html) or set MISE_BIN to the mise binary path." >&2
  exit 127
fi

if [ ! -x "$mise_bin" ]; then
  printf '%s\n' "error: MISE_BIN points at '$mise_bin', which is not executable." >&2
  exit 127
fi

exec "$mise_bin" "$@"
