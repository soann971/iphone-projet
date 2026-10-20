"""`dk snip` — gestionnaire de snippets de code, avec copie presse-papiers iOS."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

from .. import config
from ..output import bold, die, dim, info, ok, table, warn

NAME = "snip"
HELP = "gestionnaire de snippets de code (add/ls/get/rm/search)"

_DB = "snippets.json"


def configure(parser) -> None:
    parser.set_defaults(_help_parser=parser)
    sub = parser.add_subparsers(dest="action", metavar="<action>")

    a = sub.add_parser("add", help="ajouter un snippet (contenu via arg, -f ou stdin)")
    a.add_argument("name", help="nom unique")
    a.add_argument("content", nargs="?", help="contenu (sinon -f ou stdin)")
    a.add_argument("-f", "--file", help="lire le contenu depuis un fichier")
    a.add_argument("-l", "--lang", default="", help="langage (pour l'affichage)")
    a.add_argument("--force", action="store_true", help="écraser si existe déjà")

    g = sub.add_parser("get", help="afficher un snippet (et le copier)")
    g.add_argument("name")
    g.add_argument("--no-copy", action="store_true", help="ne pas copier au presse-papiers")

    sub.add_parser("ls", help="lister les snippets")

    r = sub.add_parser("rm", help="supprimer un snippet")
    r.add_argument("name")

    s = sub.add_parser("search", help="chercher dans les noms et contenus")
    s.add_argument("query")


def _load() -> dict:
    p = config.path(_DB)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        warn("base de snippets illisible, réinitialisation en mémoire")
        return {}


def _save(data: dict) -> None:
    config.path(_DB).write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def run(args) -> int:
    action = getattr(args, "action", None)
    if not action:
        args._help_parser.print_help()
        return 1

    data = _load()

    if action == "add":
        if args.name in data and not args.force:
            die(f"'{args.name}' existe déjà (utilise --force pour écraser)")
        if args.file:
            with open(args.file, "r", encoding="utf-8") as fh:
                content = fh.read()
        elif args.content is not None:
            content = args.content
        elif not sys.stdin.isatty():
            content = sys.stdin.read()
        else:
            die("aucun contenu (argument, --file ou stdin)")
        data[args.name] = {
            "content": content,
            "lang": args.lang,
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        _save(data)
        ok(f"snippet '{args.name}' enregistré ({len(content)} o)")
        return 0

    if action == "get":
        item = data.get(args.name)
        if not item:
            die(f"snippet introuvable : '{args.name}'")
        sys.stdout.write(item["content"])
        if not item["content"].endswith("\n"):
            sys.stdout.write("\n")
        if not args.no_copy:
            if config.clipboard_copy(item["content"]):
                info("copié dans le presse-papiers")
        return 0

    if action == "ls":
        if not data:
            info("aucun snippet. Ajoute-en un :  dk snip add mon-nom 'code...'")
            return 0
        rows = []
        for name, item in sorted(data.items()):
            size = len(item.get("content", ""))
            created = item.get("created", "")[:10]
            rows.append((name, item.get("lang", "") or "-", f"{size} o", created))
        table(rows, headers=("nom", "lang", "taille", "créé"))
        return 0

    if action == "rm":
        if args.name not in data:
            die(f"snippet introuvable : '{args.name}'")
        del data[args.name]
        _save(data)
        ok(f"snippet '{args.name}' supprimé")
        return 0

    if action == "search":
        q = args.query.lower()
        hits = [
            (name, item)
            for name, item in sorted(data.items())
            if q in name.lower() or q in item.get("content", "").lower()
        ]
        if not hits:
            info(f"aucun résultat pour '{args.query}'")
            return 1
        for name, item in hits:
            print(bold(name) + dim(f"  [{item.get('lang') or '?'}]"))
            first = item.get("content", "").strip().splitlines()[:1]
            if first:
                print(dim("    " + first[0][:80]))
        return 0

    return 1
