#!/usr/bin/env bash
#
# Set up the Beadsmith Fly.io Sprite from scratch.
#
# Reads .sprite in the repo root to find the org and sprite name,
# creates the sprite if it doesn't exist yet, then uploads and runs
# sprite_update_cli_tools.sh on it so the remote CLI toolchain matches
# what the rest of the scripts/ directory expects.
#
# Usage:
#   scripts/sprite_setup.sh
#
# Override the org or sprite name with SPRITE_ORG / SPRITE_NAME.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPRITE_FILE="${REPO_ROOT}/.sprite"
UPDATE_SCRIPT="${REPO_ROOT}/scripts/sprite_update_cli_tools.sh"
REMOTE_PATH="/usr/local/bin/update-cli-tools"
SPRITE_HOME="/home/sprite"
SPRITE_PROJECT_DIR="${SPRITE_PROJECT_DIR:-${SPRITE_HOME}/beadsmithy}"

# --- read org / sprite name from .sprite (or env override) ---
if [[ -n "${SPRITE_ORG:-}${SPRITE_NAME:-}" ]]; then
  ORG="${SPRITE_ORG:-}"
  NAME="${SPRITE_NAME:-}"
elif [[ -f "$SPRITE_FILE" ]]; then
  ORG=$(sed -n 's/.*"organization"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SPRITE_FILE")
  NAME=$(sed -n 's/.*"sprite"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SPRITE_FILE")
else
  echo "❌ No .sprite file at ${SPRITE_FILE} and SPRITE_ORG/SPRITE_NAME not set." >&2
  exit 1
fi

if [[ -z "$ORG" || -z "$NAME" ]]; then
  echo "❌ .sprite must define 'organization' and 'sprite'." >&2
  exit 1
fi

# --- preflight ---
command -v sprite >/dev/null 2>&1 || { echo "❌ 'sprite' CLI not found in PATH." >&2; exit 1; }
[[ -f "$UPDATE_SCRIPT" ]] || { echo "❌ Missing ${UPDATE_SCRIPT}" >&2; exit 1; }

echo "🐭 Setting up sprite '${NAME}' in org '${ORG}'"
echo ""

# --- create sprite if it doesn't already exist ---
if sprite list -o "$ORG" 2>/dev/null | grep -qx "$NAME"; then
  echo "✅ Sprite '${NAME}' already exists — reusing it."
else
  echo "✨ Creating sprite '${NAME}'..."
  sprite create -o "$ORG" --skip-console "$NAME"
fi

echo ""
echo "📤 Uploading ${UPDATE_SCRIPT##*/} to ${REMOTE_PATH}..."
sprite exec -o "$ORG" -s "$NAME" --file "${UPDATE_SCRIPT}:${REMOTE_PATH}" -- chmod +x "$REMOTE_PATH"

echo ""
echo "🚀 Running update-cli-tools on the sprite..."
sprite exec -o "$ORG" -s "$NAME" -- update-cli-tools

echo ""

echo "🪟 Installing Tauri build prerequisites (Debian)..."
sprite exec -o "$ORG" -s "$NAME" -- bash -c '
  set -e
  apt-get update
  apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libxdo-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
'

echo ""
echo "🦀 Installing Rust toolchain (required to build Tauri)..."
sprite exec -o "$ORG" -s "$NAME" -- bash -c '
  set -e
  curl --proto "=https" --tlsv1.2 https://sh.rustup.rs -sSf | sh -s -- -y
  echo >> /home/sprite/.zshrc
  echo '\''. "$HOME/.cargo/env"'\'' >> /home/sprite/.zshrc
'

echo ""

echo "🔗 Linking Claude skills for Pi..."
sprite exec -o "$ORG" -s "$NAME" --dir "$SPRITE_HOME" -- bash -c '
  set -e
  mkdir -p .agents/skills
  ln -s ../../.claude/skills/sprite .agents/skills/sprite
  ln -s ../../.claude/skills/sprite-api-gateway .agents/skills/sprite-api-gateway
'

echo ""

echo "🧩 Installing Pi packages..."
for package in \
  npm:pi-powerline-footer \
  npm:pi-mcp-adapter \
  npm:pi-subagents \
  npm:pi-web-access \
  npm:pi-skill-palette \
  npm:@plannotator/pi-extension; do
  echo "  📦 ${package}"
  sprite exec -o "$ORG" -s "$NAME" --dir "$SPRITE_HOME" -- pi install "$package"
done

echo ""
echo "🧰 Installing Beadwork..."
sprite exec -o "$ORG" -s "$NAME" --dir "$SPRITE_HOME" -- bash -c \
  'set -e; curl -fsSL https://raw.githubusercontent.com/jallum/beadwork/main/install.sh | sh'

echo ""
echo "🍺 Installing Homebrew and Worktrunk..."
sprite exec -o "$ORG" -s "$NAME" --dir "$SPRITE_HOME" -- bash -c '
  set -e
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  echo >> /home/sprite/.zshrc
  echo '\''eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv zsh)"'\'' >> /home/sprite/.zshrc
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
  brew install worktrunk
'

echo ""
echo "🌱 Initializing Beadwork in ${SPRITE_PROJECT_DIR}..."
sprite exec -o "$ORG" -s "$NAME" --dir "$SPRITE_PROJECT_DIR" -- bw init

echo ""
echo "✅ Sprite '${NAME}' is ready."
echo "👉 Connect with:  sprite exec -o ${ORG} -s ${NAME} -- bash"
echo "👉 Or:            sprite console -o ${ORG} -s ${NAME}"
