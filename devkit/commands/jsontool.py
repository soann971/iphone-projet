"""`dk json` — formater, valider et interroger du JSON (jq minimaliste)."""
from __future__ import annotations

import json
import sys

from ..output import die

NAME = "json"
HELP = "formater / valider / interroger du JSON"


def configure(parser) -> None:
    parser.add_argument("file", nargs="?", help="fichier JSON (sinon stdin)")
    parser.add_argument(
        "-q",
        "--query",
        help="chemin pointé, ex. users.0.name  (indices numériques pour les listes)",
    )
    parser.add_argument("-c", "--compact", action="store_true", help="sortie compacte")
    parser.add_argument("-s", "--sort-keys", action="store_true", help="trier les clés")
    parser.add_argument(
        "-r", "--raw", action="store_true", help="chaîne brute sans guillemets"
    )


def _load(args):
    if args.file:
        with open(args.file, "r", encoding="utf-8") as fh:
            raw = fh.read()
    else:
        if sys.stdin.isatty():
            die("aucun JSON fourni (fichier ou stdin)")
        raw = sys.stdin.read()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        die(f"JSON invalide en ligne {exc.lineno}, colonne {exc.colno} : {exc.msg}")


def _query(data, path: str):
    cur = data
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                die(f"index de liste invalide : '{part}'")
        elif isinstance(cur, dict):
            if part not in cur:
                die(f"clé absente : '{part}'")
            cur = cur[part]
        else:
            die(f"impossible de descendre dans '{part}' (valeur scalaire)")
    return cur


def run(args) -> int:
    data = _load(args)

    if args.query:
        data = _query(data, args.query)

    if args.raw and isinstance(data, str):
        print(data)
        return 0

    if args.compact:
        print(json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=args.sort_keys))
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=args.sort_keys))
    return 0
