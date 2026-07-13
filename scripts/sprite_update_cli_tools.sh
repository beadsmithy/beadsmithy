#!/usr/bin/env bash
#
# Copy to sprite (preferred: byte-accurate upload via -file)
# sprite exec --file scripts/sprite_update_cli_tools.sh:/usr/local/bin/update-cli-tools -- chmod +x /usr/local/bin/update-cli-tools
#
# Run it
# sprite exec -- update-cli-tools

set -e

echo "🔄 Updating CLI tools to latest versions (parallel)..."
echo ""

# --- npm installs (sequential, they share global state) ---
(
    echo "📦 Updating Pi.dev, Paseo.sh..."
    npm install -g @earendil-works/pi-coding-agent @getpaseo/cli

    echo "📦 Updating Gemini..."
    timeout 60s npm install -g @google/gemini-cli@latest || echo "Gemini update failed or timed out"
) &

(
    echo "📦 Updating Codex..."
    curl -fsSL https://chatgpt.com/codex/install.sh | sh
) &

# --- curl-based installs (parallel, independent) ---
(
    echo "📦 Updating Kimi Code..."
    curl -L code.kimi.com/install.sh | bash
) &

(
    echo "📦 Updating Amp..."
    curl -fsSL https://ampcode.com/install.sh | bash
) &

(
    echo "📦 Updating GitHub CLI..."
    LATEST_GH=$(curl -s https://api.github.com/repos/cli/cli/releases/latest | grep tag_name | cut -d\" -f4 | sed 's/v//')
    if [ -n "$LATEST_GH" ]; then
        cd /tmp
        curl -sL "https://github.com/cli/cli/releases/download/v${LATEST_GH}/gh_${LATEST_GH}_linux_amd64.tar.gz" -o gh.tar.gz
        tar -xzf gh.tar.gz
        mkdir -p ~/.local/bin
        cp "gh_${LATEST_GH}_linux_amd64/bin/gh" ~/.local/bin/gh
        rm -rf gh.tar.gz "gh_${LATEST_GH}_linux_amd64"
        echo "gh updated to ${LATEST_GH}"
    else
        echo "Failed to fetch latest gh version"
    fi
) &

wait

echo ""
echo "✅ Done! Current versions:"
codex --version 2>/dev/null || echo "Codex: not found"
echo "gemini: $(gemini --version 2>/dev/null)" || echo "Gemini: not found"
kimi --version 2>/dev/null || echo "Kimi: not found"
echo "amp: $(amp --version 2>/dev/null)" || echo "Amp: not found"
ln -sf "$(npm config get prefix)/bin/pi" /usr/local/bin/pi 2>/dev/null
echo "pi: $(pi --version 2>/dev/null)" || echo "pi: not found"
ln -sf "$(npm config get prefix)/bin/paseo" /usr/local/bin/paseo 2>/dev/null
echo "paseo: $(paseo --version 2>/dev/null)" || echo "paseo: not found"
~/.local/bin/gh --version 2>/dev/null | head -1 || gh --version 2>/dev/null | head -1 || echo "gh: not found"
