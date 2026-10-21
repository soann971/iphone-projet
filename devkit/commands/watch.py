"""`dk watch` — relance une commande à chaque modification de fichier.

Surveillance par sondage des dates de modification (mtime), ce qui reste fiable
sur iSH où les notifications inotify ne le sont pas. Idéal pour relancer des
tests ou un build en continu pendant qu'on code.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import time
from datetime import datetime

from ..output import bold, cyan, dim, die, info

NAME = "watch"
HELP = "relancer une commande à chaque modification de fichier"

_IGNORE_DIRS = {
    ".git", "__pycache__", "node_modules", ".venv", "venv",
    ".mypy_cache", ".pytest_cache", ".tox", "dist", "build",
}
_IGNORE_SUFFIXES = (".pyc", ".pyo", ".swp", ".swx", "~")


def configure(parser) -> None:
    parser.add_argument(
        "-p", "--path", action="append", default=[], metavar="CHEMIN",
        help="fichier ou dossier à surveiller (répétable, def. dossier courant)",
    )
    parser.add_argument(
        "-i", "--interval", type=float, default=1.0, help="intervalle de sondage (s)"
    )
    parser.add_argument(
        "-e", "--ext", action="append", default=[], metavar="EXT",
        help="ne surveiller que ces extensions, ex. -e py -e html",
    )
    parser.add_argument("-c", "--clear", action="store_true", help="effacer l'écran avant chaque exécution")
    parser.add_argument(
        "-1", "--no-initial", action="store_true", help="ne pas exécuter au démarrage"
    )
    parser.add_argument(
        "command", nargs=argparse.REMAINDER,
        help="commande à exécuter (précède-la de -- si elle a ses propres options)",
    )


def _matches_ext(name: str, exts) -> bool:
    if not exts:
        return True
    return any(name.endswith("." + e.lstrip(".")) for e in exts)


def _snapshot(paths, exts) -> dict:
    """Associe chaque fichier surveillé à sa date de modification."""
    seen: dict[str, float] = {}
    for base in paths:
        if os.path.isfile(base):
            if _matches_ext(os.path.basename(base), exts):
                try:
                    seen[base] = os.path.getmtime(base)
                except OSError:
                    pass
            continue
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in _IGNORE_DIRS]
            for fname in files:
                if fname.endswith(_IGNORE_SUFFIXES):
                    continue
                if not _matches_ext(fname, exts):
                    continue
                full = os.path.join(root, fname)
                try:
                    seen[full] = os.path.getmtime(full)
                except OSError:
                    pass
    return seen


def _changed(old: dict, new: dict):
    if old.keys() != new.keys():
        added = set(new) - set(old)
        removed = set(old) - set(new)
        pick = next(iter(added or removed))
        return pick, ("+" if added else "-")
    for path, mtime in new.items():
        if old.get(path) != mtime:
            return path, "~"
    return None, None


def _run(command, clear: bool):
    if clear:
        print("\033[2J\033[H", end="")
    stamp = datetime.now().strftime("%H:%M:%S")
    print(f"{cyan('▶')} {dim(stamp)} {bold(' '.join(command))}")
    start = time.perf_counter()
    try:
        rc = subprocess.run(command).returncode
    except FileNotFoundError:
        die(f"commande introuvable : {command[0]}")
    elapsed = time.perf_counter() - start
    mark = "✓" if rc == 0 else f"✗ (code {rc})"
    print(dim(f"{mark} — {elapsed:.2f}s"))


def run(args) -> int:
    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        die("aucune commande fournie (ex. dk watch -- pytest -x)")

    paths = [os.path.abspath(p) for p in (args.path or ["."])]
    for p in paths:
        if not os.path.exists(p):
            die(f"chemin inexistant : {p}")

    info(f"surveillance de {', '.join(paths)}  (Ctrl+C pour arrêter)")
    state = _snapshot(paths, args.ext)
    info(f"{len(state)} fichier(s) suivi(s)")

    if not args.no_initial:
        _run(command, args.clear)
        # On réabsorbe les fichiers éventuellement écrits par la commande,
        # pour qu'ils ne déclenchent pas une relance en boucle.
        state = _snapshot(paths, args.ext)

    try:
        while True:
            time.sleep(args.interval)
            new_state = _snapshot(paths, args.ext)
            path, kind = _changed(state, new_state)
            if path:
                rel = os.path.relpath(path)
                print()
                info(f"changement {kind} {rel}")
                _run(command, args.clear)
                state = _snapshot(paths, args.ext)
            else:
                state = new_state
    except KeyboardInterrupt:
        print()
        info("surveillance arrêtée")
    return 0
