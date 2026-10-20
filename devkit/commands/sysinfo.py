"""`dk sys` — état rapide de la machine : réseau, disque, système."""
from __future__ import annotations

import os
import platform
import shutil
import socket
import sys

from .. import net
from ..output import bold, dim, table

NAME = "sys"
HELP = "infos système & réseau (IP locales, disque, python)"


def configure(parser) -> None:
    pass


def _human(n: int) -> str:
    size = float(n)
    for unit in ("o", "Ko", "Mo", "Go", "To"):
        if size < 1024 or unit == "To":
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} To"


def run(args) -> int:
    print(bold("Système"))
    rows = [
        ("hôte", socket.gethostname()),
        ("os", f"{platform.system()} {platform.release()}"),
        ("machine", platform.machine()),
        ("python", platform.python_version()),
        ("cwd", os.getcwd()),
    ]
    table(rows)

    print()
    print(bold("Réseau"))
    ips = net.local_ips()
    if ips:
        table([("ip locale", ip) for ip in ips])
    else:
        print(dim("  aucune IP locale détectée"))

    print()
    print(bold("Disque") + dim("  (dossier courant)"))
    try:
        usage = shutil.disk_usage(os.getcwd())
        used_pct = usage.used / usage.total * 100 if usage.total else 0
        table(
            [
                ("total", _human(usage.total)),
                ("utilisé", f"{_human(usage.used)}  ({used_pct:.0f} %)"),
                ("libre", _human(usage.free)),
            ]
        )
    except OSError as exc:
        print(dim(f"  indisponible : {exc}"))

    return 0
