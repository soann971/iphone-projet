"""Sortie terminal : couleurs ANSI (avec détection TTY et respect de NO_COLOR)
et petits helpers de messages + tableaux alignés."""
from __future__ import annotations

import os
import sys


def _color_enabled() -> bool:
    if os.environ.get("NO_COLOR") or os.environ.get("DK_NO_COLOR"):
        return False
    return sys.stdout.isatty()


_ON = _color_enabled()


def _c(code: str, s: str) -> str:
    return f"\033[{code}m{s}\033[0m" if _ON else s


def bold(s: str) -> str:
    return _c("1", s)


def dim(s: str) -> str:
    return _c("2", s)


def red(s: str) -> str:
    return _c("31", s)


def green(s: str) -> str:
    return _c("32", s)


def yellow(s: str) -> str:
    return _c("33", s)


def blue(s: str) -> str:
    return _c("34", s)


def cyan(s: str) -> str:
    return _c("36", s)


def info(msg: str) -> None:
    print(f"{cyan('›')} {msg}")


def ok(msg: str) -> None:
    print(f"{green('✓')} {msg}")


def warn(msg: str) -> None:
    print(f"{yellow('!')} {msg}", file=sys.stderr)


def err(msg: str) -> None:
    print(f"{red('✗')} {msg}", file=sys.stderr)


def die(msg: str, code: int = 1):
    err(msg)
    raise SystemExit(code)


def table(rows, headers=None) -> None:
    """Affiche un tableau aligné. `rows` : liste de tuples de chaînes."""
    rows = [tuple(str(c) for c in r) for r in rows]
    if headers:
        headers = tuple(str(h) for h in headers)
        all_rows = [headers, *rows]
    else:
        all_rows = rows
    if not all_rows:
        return
    ncol = max(len(r) for r in all_rows)
    widths = [0] * ncol
    for r in all_rows:
        for i, cell in enumerate(r):
            widths[i] = max(widths[i], len(cell))
    if headers:
        print("  ".join(bold(h.ljust(widths[i])) for i, h in enumerate(headers)))
        print(dim("  ".join("-" * widths[i] for i in range(ncol))))
    for r in rows:
        cells = [(r[i] if i < len(r) else "").ljust(widths[i]) for i in range(ncol)]
        print("  ".join(cells))
