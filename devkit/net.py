"""Utilitaires réseau : découverte des adresses IPv4 locales (LAN)."""
from __future__ import annotations

import socket


def local_ips() -> list[str]:
    """Renvoie les IPv4 locales plausibles pour atteindre la machine depuis
    le même réseau wifi (hors loopback)."""
    ips: set[str] = set()

    # IP de l'interface par défaut : on "connecte" un socket UDP (aucun paquet
    # n'est réellement envoyé) pour lire l'adresse source choisie par l'OS.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ips.add(s.getsockname()[0])
        finally:
            s.close()
    except OSError:
        pass

    # Complément : adresses associées au nom d'hôte.
    try:
        host = socket.gethostname()
        for info in socket.getaddrinfo(host, None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass

    ips.discard("127.0.0.1")
    return sorted(ips)
