"""Paquet des commandes.

Chaque module de ce dossier qui expose les attributs suivants devient
automatiquement une sous-commande `dk`, sans la câbler nulle part :

    NAME        : str            -> nom de la sous-commande (ex. "serve")
    HELP        : str            -> description courte
    configure(parser)           -> (optionnel) ajoute les arguments argparse
    run(args) -> int | None     -> exécute, renvoie un code de sortie

Pour ajouter un outil : créer un fichier ici. C'est tout.
"""
