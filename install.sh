#!/bin/sh
# Installe la commande `dk` globalement (lien symbolique dans le PATH).
# Fonctionne sur iSH (Alpine) comme sur Linux/macOS.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-/usr/local/bin}"

if [ ! -d "$TARGET" ]; then
  mkdir -p "$TARGET" 2>/dev/null || {
    echo "Impossible de créer $TARGET — réessaie avec sudo, ou passe un dossier du PATH :"
    echo "   ./install.sh \$HOME/.local/bin"
    exit 1
  }
fi

ln -sf "$HERE/dk" "$TARGET/dk"
chmod +x "$HERE/dk"

echo "✓ Installé : $TARGET/dk  ->  $HERE/dk"
echo
if ! command -v dk >/dev/null 2>&1; then
  echo "! $TARGET n'est pas dans ton PATH. Ajoute ceci à ~/.profile :"
  echo "    export PATH=\"$TARGET:\$PATH\""
fi
echo "Essaie :  dk --help"
