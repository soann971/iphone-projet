"""Emplacement des données (~/.devkit) et intégration presse-papiers.

Sur iSH, `pbcopy`/`pbpaste` relient le terminal au presse-papiers iOS : les
snippets peuvent donc être copiés directement pour être collés dans une autre
app. On dégrade proprement si ces outils n'existent pas (Linux, CI…)."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

HOME = Path(os.environ.get("DEVKIT_HOME", str(Path.home() / ".devkit"))).expanduser()

_COPY_TOOLS = (["pbcopy"], ["wl-copy"], ["xclip", "-selection", "clipboard"])
_PASTE_TOOLS = (["pbpaste"], ["wl-paste"], ["xclip", "-selection", "clipboard", "-o"])


def ensure_home() -> Path:
    HOME.mkdir(parents=True, exist_ok=True)
    return HOME


def path(*parts: str) -> Path:
    ensure_home()
    return HOME.joinpath(*parts)


def clipboard_copy(text: str) -> bool:
    """Copie `text` dans le presse-papiers. Renvoie True si un outil a marché."""
    for tool in _COPY_TOOLS:
        if shutil.which(tool[0]):
            try:
                subprocess.run(tool, input=text.encode(), check=True)
                return True
            except Exception:
                continue
    return False


def clipboard_paste() -> str | None:
    for tool in _PASTE_TOOLS:
        if shutil.which(tool[0]):
            try:
                out = subprocess.run(tool, capture_output=True, check=True)
                return out.stdout.decode()
            except Exception:
                continue
    return None
