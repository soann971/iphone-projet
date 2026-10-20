"""Cœur du CLI : découverte automatique des commandes + dispatch.

Les sous-commandes ne sont jamais enregistrées à la main : on parcourt le
paquet `devkit.commands`, et tout module exposant NAME/run devient une
sous-commande argparse avec son aide générée automatiquement.
"""
from __future__ import annotations

import argparse
import importlib
import pkgutil
import sys

from . import __version__, commands
from .output import err


def _iter_command_modules():
    """Importe paresseusement chaque module de devkit.commands."""
    for info in pkgutil.iter_modules(commands.__path__, commands.__name__ + "."):
        if info.name.rsplit(".", 1)[-1].startswith("_"):
            continue
        yield importlib.import_module(info.name)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dk",
        description="devkit — boîte à outils dev pour le terminal (iSH friendly)",
    )
    parser.add_argument(
        "-V", "--version", action="version", version=f"devkit {__version__}"
    )
    sub = parser.add_subparsers(dest="command", metavar="<command>")

    modules = sorted(
        (m for m in _iter_command_modules() if getattr(m, "NAME", None)),
        key=lambda m: m.NAME,
    )
    for mod in modules:
        cp = sub.add_parser(
            mod.NAME,
            help=getattr(mod, "HELP", ""),
            description=getattr(mod, "HELP", ""),
        )
        if hasattr(mod, "configure"):
            mod.configure(cp)
        cp.set_defaults(_handler=mod.run)
    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    handler = getattr(args, "_handler", None)
    if handler is None:
        parser.print_help()
        return 0

    try:
        return handler(args) or 0
    except KeyboardInterrupt:
        print()
        return 130
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except Exception:
            pass
        return 0
    except SystemExit:
        raise
    except Exception as exc:  # garde-fou : jamais de traceback brut à l'écran
        err(f"{type(exc).__name__}: {exc}")
        return 1
