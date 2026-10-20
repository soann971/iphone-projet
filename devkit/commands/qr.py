"""`dk qr` — générer un QR code affiché directement dans le terminal."""
from __future__ import annotations

import sys

from .. import qr as _qr
from ..output import die, dim

NAME = "qr"
HELP = "générer un QR code dans le terminal (URL, texte, wifi…)"


def configure(parser) -> None:
    parser.add_argument("text", nargs="?", help="texte à encoder (sinon stdin)")
    parser.add_argument(
        "-e", "--ecc", default="M", choices=("L", "M", "Q", "H"),
        help="niveau de correction d'erreur (def. M)",
    )
    parser.add_argument("-q", "--quiet", type=int, default=4, help="zone de silence")
    parser.add_argument(
        "--ascii", action="store_true", help="forcer le rendu ASCII (sans couleur)"
    )


def run(args) -> int:
    text = args.text
    if text is None:
        if sys.stdin.isatty():
            die("aucun texte fourni (argument ou stdin)")
        text = sys.stdin.read().rstrip("\n")
    if not text:
        die("texte vide")

    try:
        matrix = _qr.make(text, level=args.ecc)
    except ValueError as exc:
        die(str(exc))

    color = not args.ascii and sys.stdout.isatty()
    print()
    for line in _qr.render_lines(matrix, quiet=max(1, args.quiet), color=color):
        print(line)
    print()
    print(dim(f"  {len(matrix)}×{len(matrix)} · correction {args.ecc} · {len(text)} o"))
    return 0
