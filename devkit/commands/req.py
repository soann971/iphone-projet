"""`dk req` — client HTTP minimal façon curl/httpie, en pur urllib."""
from __future__ import annotations

import json as _json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

from ..output import bold, cyan, dim, green, red, yellow

NAME = "req"
HELP = "client HTTP minimal (GET/POST/… en urllib)"


def configure(parser) -> None:
    parser.add_argument("url", help="URL (http(s)://… ; https par défaut si omis)")
    parser.add_argument("-X", "--method", default="GET", help="méthode HTTP")
    parser.add_argument(
        "-H", "--header", action="append", default=[], metavar="K:V", help="en-tête"
    )
    parser.add_argument(
        "-q", "--query", action="append", default=[], metavar="K=V",
        help="paramètre de query string",
    )
    parser.add_argument("-d", "--data", help="corps brut")
    parser.add_argument("-j", "--json", help="corps JSON (fixe Content-Type)")
    parser.add_argument(
        "-i", "--include", action="store_true", help="afficher les en-têtes de réponse"
    )
    parser.add_argument("-t", "--timeout", type=float, default=30.0, help="timeout (s)")
    parser.add_argument(
        "-k", "--insecure", action="store_true", help="ne pas vérifier le certificat TLS"
    )


def _status_color(code: int) -> str:
    if code < 300:
        return green(str(code))
    if code < 400:
        return cyan(str(code))
    if code < 500:
        return yellow(str(code))
    return red(str(code))


def _print_body(raw: bytes, content_type: str) -> None:
    text = raw.decode("utf-8", errors="replace")
    if "json" in content_type or text[:1] in "{[":
        try:
            parsed = _json.loads(text)
            print(_json.dumps(parsed, ensure_ascii=False, indent=2))
            return
        except ValueError:
            pass
    print(text)


def run(args) -> int:
    url = args.url
    if "://" not in url:
        url = "https://" + url

    if args.query:
        parts = urllib.parse.urlsplit(url)
        q = urllib.parse.parse_qsl(parts.query)
        for item in args.query:
            k, _, v = item.partition("=")
            q.append((k, v))
        url = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(q)))

    headers = {}
    for h in args.header:
        k, _, v = h.partition(":")
        headers[k.strip()] = v.strip()

    body = None
    method = args.method.upper()
    if args.json is not None:
        body = args.json.encode()
        headers.setdefault("Content-Type", "application/json")
        if method == "GET":
            method = "POST"
    elif args.data is not None:
        body = args.data.encode()
        if method == "GET":
            method = "POST"

    ctx = None
    if args.insecure:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    request = urllib.request.Request(url, data=body, headers=headers, method=method)

    start = time.perf_counter()
    try:
        resp = urllib.request.urlopen(request, timeout=args.timeout, context=ctx)
        status, reason, raw = resp.status, resp.reason, resp.read()
        resp_headers = resp.headers
    except urllib.error.HTTPError as exc:
        status, reason, raw = exc.code, exc.reason, exc.read()
        resp_headers = exc.headers
    except urllib.error.URLError as exc:
        print(red(f"✗ échec : {exc.reason}"))
        return 1
    elapsed = (time.perf_counter() - start) * 1000

    print(
        f"{bold(method)} {url}  →  {_status_color(status)} {reason}  "
        f"{dim(f'{elapsed:.0f} ms · {len(raw)} o')}"
    )
    if args.include:
        for k, v in resp_headers.items():
            print(f"{cyan(k)}: {v}")
        print()

    _print_body(raw, resp_headers.get("Content-Type", ""))
    return 0 if status < 400 else 1
