# devkit (`dk`)

Une boîte à outils dev en terminal, pensée pour **iSH sur iPhone** — mais qui
tourne partout (Linux, macOS).

**Zéro dépendance.** 100 % bibliothèque standard Python. Aucun `pip install` à
compiler, ce qui est crucial sur iSH où l'x86 est émulé : l'installation est
instantanée et ne casse jamais.

```
$ dk --help
  gen      générateurs & encodeurs (uuid, hash, b64, pass, now)
  json     formater / valider / interroger du JSON
  qr       générer un QR code dans le terminal
  req      client HTTP minimal (GET/POST/… en urllib)
  serve    serveur de fichiers LAN avec upload (partage iPhone ↔ PC)
  snip     gestionnaire de snippets de code
  sys      infos système & réseau
  wifi     QR code de connexion wifi
```

## Installation sur iSH

```sh
apk add python3 git          # si pas déjà fait
git clone <url-de-ce-repo> devkit && cd devkit
./install.sh                 # crée la commande globale `dk`
dk --help
```

Pas d'installation ? `./dk <commande>` fonctionne directement depuis le clone.

## Les outils

### `dk serve` — partager des fichiers iPhone ↔ PC
Lance un serveur web sur le wifi local, avec **upload** (formulaire sur chaque
page) et téléchargement. Affiche les URL à ouvrir depuis un autre appareil.
```sh
dk serve ~/Documents          # sert un dossier (défaut : courant)
dk serve -p 9000 --no-upload  # autre port, lecture seule
```

### `dk qr` — QR code dans le terminal
Encodeur QR **écrit from scratch, zéro dépendance** (Reed-Solomon sur GF(256),
masquage, patterns). Rendu en demi-blocs colorés, scannable quel que soit le
thème du terminal. `dk serve` l'utilise pour afficher l'URL à scanner.
```sh
dk qr "https://exemple.com"        # correction M par défaut
dk qr "mon texte" -e H             # correction maximale
echo "depuis stdin" | dk qr
```
Validé par round-trip de décodage (1600+ cas) et décodeurs externes (OpenCV).

### `dk wifi` — QR de connexion wifi
Génère le QR au format standard `WIFI:...;;` (reconnu par iOS et Android) :
un invité le scanne et se connecte sans taper le mot de passe.
```sh
dk wifi "Maison_5G" "motdepasse"       # WPA par défaut
dk wifi "OpenNet" -t nopass            # réseau ouvert
dk wifi "HiddenNet" "mdp" -H           # SSID masqué
dk wifi "Box" "mdp" --show             # affiche aussi la chaîne brute
```
Les caractères spéciaux (`;` `:` `,` `"` `\`) sont échappés automatiquement.

### `dk req` — client HTTP (façon curl/httpie)
```sh
dk req api.github.com/users/torvalds        # GET (https par défaut)
dk req -X POST httpbin.org/post -j '{"a":1}'  # corps JSON
dk req -i -H "Authorization: Bearer x" <url>  # en-têtes + afficher la réponse
```
Les réponses JSON sont automatiquement reformatées.

### `dk json` — formater / valider / interroger
```sh
cat data.json | dk json                 # pretty-print + validation
dk json data.json -q users.0.name -r    # extraire une valeur (chemin pointé)
dk json data.json -c -s                 # compact, clés triées
```

### `dk snip` — snippets de code (+ presse-papiers iOS)
```sh
dk snip add deploy "git push && ssh prod 'cd app && git pull'" -l sh
dk snip ls
dk snip get deploy       # affiche ET copie dans le presse-papiers (pbcopy)
dk snip search ssh
```

### `dk gen` — générateurs & encodeurs
```sh
dk gen uuid -n 3
dk gen hash sha256 "texte"      # ou -f fichier, ou via stdin
dk gen b64 "texte"  /  dk gen b64 -d "dGV4dGU="
dk gen pass -n 24               # mot de passe sûr (module secrets)
dk gen now                      # local / utc / epoch
```

### `dk sys` — état de la machine
IP locales (pour `dk serve`), disque, système, version Python.

## Architecture — ajouter un outil

Les commandes sont **auto-découvertes**. Pour en ajouter une, crée un fichier
dans `devkit/commands/` exposant :

```python
NAME = "mon-outil"
HELP = "ce que ça fait"

def configure(parser):          # optionnel : arguments argparse
    parser.add_argument("cible")

def run(args):                  # renvoie un code de sortie (0 = ok)
    print(args.cible)
    return 0
```

C'est tout — elle apparaît aussitôt dans `dk --help`. Aucun câblage ailleurs.

## Compatibilité
Python ≥ 3.9. Testé jusqu'à 3.13 (le parsing multipart de `dk serve` est fait
maison, car le module `cgi` a été retiré en 3.13).
