"""`dk gen` — générateurs & encodeurs du quotidien."""
from __future__ import annotations

import base64
import hashlib
import secrets
import string
import sys
import uuid as _uuid
from datetime import datetime, timezone

from ..output import die, dim, ok

NAME = "gen"
HELP = "générateurs & encodeurs (uuid, hash, b64, pass, now)"


def configure(parser) -> None:
    parser.set_defaults(_help_parser=parser)
    sub = parser.add_subparsers(dest="kind", metavar="<kind>")

    u = sub.add_parser("uuid", help="UUID v4")
    u.add_argument("-n", "--count", type=int, default=1, help="nombre d'UUID")

    h = sub.add_parser("hash", help="hash d'un texte, d'un fichier ou de stdin")
    h.add_argument(
        "algo",
        choices=sorted(hashlib.algorithms_guaranteed),
        help="algorithme (sha256, md5, …)",
    )
    h.add_argument("text", nargs="?", help="texte à hasher (sinon stdin)")
    h.add_argument("-f", "--file", help="hasher un fichier")

    b = sub.add_parser("b64", help="encode/décode en base64")
    b.add_argument("text", nargs="?", help="texte (sinon stdin)")
    b.add_argument("-d", "--decode", action="store_true", help="décoder")

    pw = sub.add_parser("pass", help="mot de passe aléatoire sûr (module secrets)")
    pw.add_argument("-n", "--length", type=int, default=20, help="longueur")
    pw.add_argument("--no-symbols", action="store_true", help="lettres+chiffres seuls")

    nw = sub.add_parser("now", help="horodatage courant")
    nw.add_argument("--epoch", action="store_true", help="seconds epoch uniquement")


def _stdin_text() -> str:
    if sys.stdin.isatty():
        die("aucun texte fourni (argument ou stdin)")
    return sys.stdin.read().rstrip("\n")


def run(args) -> int:
    kind = getattr(args, "kind", None)
    if not kind:
        args._help_parser.print_help()
        return 1

    if kind == "uuid":
        for _ in range(max(1, args.count)):
            print(_uuid.uuid4())
        return 0

    if kind == "hash":
        digest = hashlib.new(args.algo)
        if args.file:
            with open(args.file, "rb") as fh:
                for chunk in iter(lambda: fh.read(65536), b""):
                    digest.update(chunk)
        else:
            text = args.text if args.text is not None else _stdin_text()
            digest.update(text.encode())
        print(digest.hexdigest())
        return 0

    if kind == "b64":
        text = args.text if args.text is not None else _stdin_text()
        if args.decode:
            try:
                sys.stdout.buffer.write(base64.b64decode(text, validate=True))
                if sys.stdout.isatty():
                    print()
            except Exception as exc:
                die(f"base64 invalide : {exc}")
        else:
            print(base64.b64encode(text.encode()).decode())
        return 0

    if kind == "pass":
        if args.length < 1:
            die("longueur invalide")
        alphabet = string.ascii_letters + string.digits
        if not args.no_symbols:
            alphabet += "!@#$%^&*()-_=+[]{}"
        pwd = "".join(secrets.choice(alphabet) for _ in range(args.length))
        print(pwd)
        ok("copie :  dk gen pass | pbcopy")
        return 0

    if kind == "now":
        now = datetime.now(timezone.utc)
        if args.epoch:
            print(int(now.timestamp()))
            return 0
        local = datetime.now().astimezone()
        print(f"{dim('local'):<10} {local.isoformat(timespec='seconds')}")
        print(f"{dim('utc'):<10} {now.isoformat(timespec='seconds')}")
        print(f"{dim('epoch'):<10} {int(now.timestamp())}")
        return 0

    return 1
