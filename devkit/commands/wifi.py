"""`dk wifi` — QR code de connexion à un réseau wifi.

Produit un QR au format standard `WIFI:...;;` reconnu par iOS et Android :
l'invité le scanne et se connecte sans taper le mot de passe.
"""
from __future__ import annotations

import sys

from .. import qr as _qr
from ..output import die, dim, ok

NAME = "wifi"
HELP = "QR code de connexion wifi (un invité scanne, il est connecté)"


def configure(parser) -> None:
    parser.add_argument("ssid", help="nom du réseau (SSID)")
    parser.add_argument("password", nargs="?", help="mot de passe (sauf réseau ouvert)")
    parser.add_argument(
        "-t", "--type", default="WPA", choices=("WPA", "WEP", "nopass"),
        help="type de sécurité (def. WPA)",
    )
    parser.add_argument(
        "-H", "--hidden", action="store_true", help="réseau à SSID masqué"
    )
    parser.add_argument(
        "-e", "--ecc", default="M", choices=("L", "M", "Q", "H"),
        help="niveau de correction d'erreur (def. M)",
    )
    parser.add_argument("--ascii", action="store_true", help="rendu ASCII (sans couleur)")
    parser.add_argument(
        "--show", action="store_true", help="afficher aussi la chaîne WIFI brute"
    )


def _escape(value: str) -> str:
    # Dans le format WIFI, \ ; , : " doivent être précédés d'un antislash.
    for ch in ("\\", ";", ",", ":", '"'):
        value = value.replace(ch, "\\" + ch)
    return value


def build_payload(ssid: str, password, security: str, hidden: bool) -> str:
    if security == "nopass":
        password = None
    elif not password:
        die("mot de passe requis (ou utilise -t nopass pour un réseau ouvert)")

    parts = [f"T:{security}", f"S:{_escape(ssid)}"]
    if password is not None:
        parts.append(f"P:{_escape(password)}")
    if hidden:
        parts.append("H:true")
    return "WIFI:" + ";".join(parts) + ";;"


def run(args) -> int:
    payload = build_payload(args.ssid, args.password, args.type, args.hidden)

    try:
        matrix = _qr.make(payload, level=args.ecc)
    except ValueError as exc:
        die(str(exc))

    color = not args.ascii and sys.stdout.isatty()
    print()
    for line in _qr.render_lines(matrix, quiet=4, color=color):
        print(line)
    print()
    ok(f"Réseau « {args.ssid} » · sécurité {args.type}")
    if args.show:
        print(dim("  " + payload))
    return 0
