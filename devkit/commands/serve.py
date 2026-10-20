"""`dk serve` — serveur de fichiers LAN avec upload.

Idéal sur iSH : partager instantanément des fichiers entre l'iPhone et
n'importe quel appareil du même wifi, dans les deux sens (téléchargement +
upload via un formulaire). Parsing multipart maison car le module `cgi` a
été retiré de la bibliothèque standard en Python 3.13.
"""
from __future__ import annotations

import functools
import html
import os
import socket
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from urllib.parse import quote, unquote

import sys

from .. import net, qr
from ..output import bold, cyan, dim, info, ok, warn

NAME = "serve"
HELP = "serveur de fichiers LAN avec upload (partage iPhone ↔ PC)"

_PAGE = """<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>devkit · {title}</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font: 16px/1.5 -apple-system, system-ui, sans-serif; max-width: 760px;
         margin: 0 auto; padding: 16px; }}
  h1 {{ font-size: 1.1rem; word-break: break-all; }}
  ul {{ list-style: none; padding: 0; }}
  li {{ padding: 8px 0; border-bottom: 1px solid #8884; }}
  a {{ text-decoration: none; }}
  .dir {{ font-weight: 600; }}
  .size {{ color: #8889; font-variant-numeric: tabular-nums; float: right; }}
  form {{ margin: 16px 0; padding: 16px; border: 1px dashed #8886; border-radius: 10px; }}
  button {{ font: inherit; padding: 8px 16px; border-radius: 8px; border: 0;
           background: #2563eb; color: #fff; }}
</style></head><body>
<h1>{title}</h1>
<form method="post" enctype="multipart/form-data">
  <input type="file" name="file" multiple required>
  <button type="submit">Envoyer ici</button>
</form>
<ul>{entries}</ul>
</body></html>"""


def configure(parser) -> None:
    parser.add_argument("directory", nargs="?", default=".", help="dossier à servir")
    parser.add_argument("-p", "--port", type=int, default=8000, help="port (def. 8000)")
    parser.add_argument(
        "-b", "--bind", default="0.0.0.0", help="adresse d'écoute (def. toutes)"
    )
    parser.add_argument(
        "--no-upload", action="store_true", help="désactiver l'upload (lecture seule)"
    )
    parser.add_argument(
        "--no-qr", action="store_true", help="ne pas afficher le QR code de l'URL"
    )


def _parse_multipart(body: bytes, boundary: bytes):
    """Extrait les (filename, data) d'un corps multipart/form-data."""
    results = []
    sep = b"--" + boundary
    for part in body.split(sep):
        if not part or part in (b"--\r\n", b"--", b"\r\n"):
            continue
        part = part.strip(b"\r\n")
        head, _, data = part.partition(b"\r\n\r\n")
        if not _:
            continue
        disposition = b""
        for line in head.split(b"\r\n"):
            if line.lower().startswith(b"content-disposition:"):
                disposition = line
                break
        filename = None
        for token in disposition.split(b";"):
            token = token.strip()
            if token.lower().startswith(b"filename="):
                filename = token[len(b"filename="):].strip(b'"').decode(
                    "utf-8", "replace"
                )
        if filename:
            results.append((filename, data))
    return results


def _make_handler(allow_upload: bool):
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, fmt, *a):  # journaux compacts
            info(f"{self.address_string()}  {fmt % a}")

        def list_directory(self, path):
            try:
                names = sorted(os.listdir(path), key=lambda s: s.lower())
            except OSError:
                self.send_error(HTTPStatus.NOT_FOUND, "dossier illisible")
                return None
            rel = unquote(self.path)
            items = []
            if rel not in ("/", ""):
                items.append('<li><a class="dir" href="..">../</a></li>')
            for name in names:
                full = os.path.join(path, name)
                is_dir = os.path.isdir(full)
                disp = name + ("/" if is_dir else "")
                link = quote(name) + ("/" if is_dir else "")
                size = ""
                if not is_dir:
                    try:
                        size = f'<span class="size">{os.path.getsize(full)} o</span>'
                    except OSError:
                        pass
                cls = "dir" if is_dir else ""
                items.append(
                    f'<li><a class="{cls}" href="{link}">{html.escape(disp)}</a>{size}</li>'
                )
            page = _PAGE.format(
                title=html.escape(rel) or "/",
                entries="".join(items) or "<li>(vide)</li>",
            )
            encoded = page.encode("utf-8", "replace")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            return BytesIO(encoded)

        def do_POST(self):
            if not allow_upload:
                self.send_error(HTTPStatus.FORBIDDEN, "upload désactivé")
                return
            ctype = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in ctype or "boundary=" not in ctype:
                self.send_error(HTTPStatus.BAD_REQUEST, "multipart/form-data attendu")
                return
            boundary = ctype.split("boundary=", 1)[1].strip().strip('"').encode()
            try:
                length = int(self.headers.get("Content-Length", 0))
            except ValueError:
                length = 0
            body = self.rfile.read(length)
            target_dir = self.translate_path(self.path)
            if not os.path.isdir(target_dir):
                target_dir = os.path.dirname(target_dir)
            saved = 0
            for filename, data in _parse_multipart(body, boundary):
                safe = os.path.basename(filename)
                if not safe:
                    continue
                try:
                    with open(os.path.join(target_dir, safe), "wb") as fh:
                        fh.write(data)
                    saved += 1
                    ok(f"reçu : {safe} ({len(data)} o)")
                except OSError as exc:
                    warn(f"échec écriture {safe} : {exc}")
            self.send_response(HTTPStatus.SEE_OTHER)
            self.send_header("Location", self.headers.get("Referer", self.path))
            self.end_headers()

    return Handler


def run(args) -> int:
    directory = os.path.abspath(args.directory)
    if not os.path.isdir(directory):
        from ..output import die

        die(f"pas un dossier : {directory}")

    handler = functools.partial(_make_handler(not args.no_upload), directory=directory)
    try:
        httpd = ThreadingHTTPServer((args.bind, args.port), handler)
    except OSError as exc:
        from ..output import die

        die(f"impossible d'écouter sur {args.bind}:{args.port} — {exc}")

    port = httpd.server_address[1]
    ok(f"Serveur de fichiers sur {bold(directory)}")
    if not args.no_upload:
        info("upload activé (formulaire en haut de chaque page)")
    print()
    print(bold("  Ouvre une de ces URL depuis un appareil du même wifi :"))
    print(f"    {cyan(f'http://localhost:{port}/')}  {dim('(cet appareil)')}")
    ips = net.local_ips()
    for ip in ips:
        print(f"    {cyan(f'http://{ip}:{port}/')}")

    if ips and not args.no_qr:
        url = f"http://{ips[0]}:{port}/"
        print()
        print(bold(f"  Scanne ce QR code pour ouvrir {url}"))
        print()
        color = sys.stdout.isatty()
        for line in qr.render_lines(qr.make(url, level="M"), quiet=4, color=color):
            print("  " + line)
    print()
    info("Ctrl+C pour arrêter")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print()
        info("serveur arrêté")
    finally:
        httpd.server_close()
    return 0
