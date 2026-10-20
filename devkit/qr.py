"""Encodeur QR code en pur Python (aucune dépendance).

Mode octet (byte), versions 1 à 10, niveaux de correction L/M/Q/H.
Suffisant pour des URL et textes jusqu'à ~270 octets. L'algorithme suit la
norme ISO/IEC 18004 : masque de données, Reed-Solomon sur GF(256), patterns
de repérage/alignement/synchro, et sélection de masque par pénalité.

La sortie est une matrice de 0/1 (0 = clair, 1 = sombre), sans zone de silence
— c'est le rôle du rendu de l'ajouter.
"""
from __future__ import annotations

# --- Galois Field GF(256), polynôme primitif 0x11d ------------------------
_EXP = [0] * 512
_LOG = [0] * 256
_x = 1
for _i in range(255):
    _EXP[_i] = _x
    _LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    _EXP[_i] = _EXP[_i - 255]


def _gmul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _rs_generator(n: int) -> list[int]:
    g = [1]
    for i in range(n):
        g2 = [0] * (len(g) + 1)
        for j in range(len(g)):
            g2[j] ^= g[j]
            g2[j + 1] ^= _gmul(g[j], _EXP[i])
        g = g2
    return g  # degré n, g[0] == 1


def _rs_encode(data: list[int], n: int) -> list[int]:
    gen = _rs_generator(n)
    res = [0] * n
    for b in data:
        factor = b ^ res[0]
        res.pop(0)
        res.append(0)
        for i in range(n):
            res[i] ^= _gmul(gen[i + 1], factor)
    return res


# --- Tables de la norme (versions 1-10) -----------------------------------
# (ec_par_bloc, [(nb_blocs, data_cw_par_bloc), ...])
_EC_TABLE = {
    (1, "L"): (7, [(1, 19)]), (1, "M"): (10, [(1, 16)]),
    (1, "Q"): (13, [(1, 13)]), (1, "H"): (17, [(1, 9)]),
    (2, "L"): (10, [(1, 34)]), (2, "M"): (16, [(1, 28)]),
    (2, "Q"): (22, [(1, 22)]), (2, "H"): (28, [(1, 16)]),
    (3, "L"): (15, [(1, 55)]), (3, "M"): (26, [(1, 44)]),
    (3, "Q"): (18, [(2, 17)]), (3, "H"): (22, [(2, 13)]),
    (4, "L"): (20, [(1, 80)]), (4, "M"): (18, [(2, 32)]),
    (4, "Q"): (26, [(2, 24)]), (4, "H"): (16, [(4, 9)]),
    (5, "L"): (26, [(1, 108)]), (5, "M"): (24, [(2, 43)]),
    (5, "Q"): (18, [(2, 15), (2, 16)]), (5, "H"): (22, [(2, 11), (2, 12)]),
    (6, "L"): (18, [(2, 68)]), (6, "M"): (16, [(4, 27)]),
    (6, "Q"): (24, [(4, 19)]), (6, "H"): (28, [(4, 15)]),
    (7, "L"): (20, [(2, 78)]), (7, "M"): (18, [(4, 31)]),
    (7, "Q"): (18, [(2, 14), (4, 15)]), (7, "H"): (26, [(4, 13), (1, 14)]),
    (8, "L"): (24, [(2, 97)]), (8, "M"): (22, [(2, 38), (2, 39)]),
    (8, "Q"): (22, [(4, 18), (2, 19)]), (8, "H"): (26, [(4, 14), (2, 15)]),
    (9, "L"): (30, [(2, 116)]), (9, "M"): (22, [(3, 36), (2, 37)]),
    (9, "Q"): (20, [(4, 16), (4, 17)]), (9, "H"): (24, [(4, 12), (4, 13)]),
    (10, "L"): (18, [(2, 68), (2, 69)]), (10, "M"): (26, [(4, 43), (1, 44)]),
    (10, "Q"): (24, [(6, 19), (2, 20)]), (10, "H"): (28, [(6, 15), (2, 16)]),
}

# Positions des centres des patterns d'alignement par version.
_ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
}

# Bits du niveau de correction pour l'info de format.
_ECL_FORMAT = {"M": 0, "L": 1, "H": 2, "Q": 3}

_MAX_VERSION = 10


def _total_data_cw(version: int, level: str) -> int:
    _, blocks = _EC_TABLE[(version, level)]
    return sum(n * d for n, d in blocks)


def _cc_bits(version: int) -> int:
    return 8 if version <= 9 else 16


def _choose_version(data_len: int, level: str) -> int:
    for v in range(1, _MAX_VERSION + 1):
        capacity_bits = _total_data_cw(v, level) * 8
        needed = 4 + _cc_bits(v) + 8 * data_len
        if needed <= capacity_bits:
            return v
    raise ValueError(
        f"données trop longues ({data_len} o) pour un QR version ≤ {_MAX_VERSION}"
    )


# --- Construction du flux de codewords -------------------------------------
def _build_codewords(data: bytes, level: str, version: int) -> list[int]:
    bits: list[int] = []

    def put(value: int, length: int):
        for i in range(length - 1, -1, -1):
            bits.append((value >> i) & 1)

    put(0b0100, 4)                  # indicateur de mode octet
    put(len(data), _cc_bits(version))
    for b in data:
        put(b, 8)

    cap_bits = _total_data_cw(version, level) * 8
    put(0, min(4, cap_bits - len(bits)))        # terminateur
    while len(bits) % 8:                         # alignement octet
        bits.append(0)
    pad = (0xEC, 0x11)
    k = 0
    while len(bits) < cap_bits:                  # octets de remplissage
        put(pad[k % 2], 8)
        k += 1

    data_cw = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]

    ec_per_block, blocks = _EC_TABLE[(version, level)]
    data_blocks: list[list[int]] = []
    ec_blocks: list[list[int]] = []
    pos = 0
    for count, dsize in blocks:
        for _ in range(count):
            chunk = data_cw[pos:pos + dsize]
            pos += dsize
            data_blocks.append(chunk)
            ec_blocks.append(_rs_encode(chunk, ec_per_block))

    result: list[int] = []
    for i in range(max(len(b) for b in data_blocks)):
        for b in data_blocks:
            if i < len(b):
                result.append(b[i])
    for i in range(ec_per_block):
        for b in ec_blocks:
            result.append(b[i])
    return result


# --- Matrice : patterns de fonction ----------------------------------------
def _new_matrix(size: int):
    return [[0] * size for _ in range(size)], [[False] * size for _ in range(size)]


def _place_finder(mat, func, size, r, c):
    for dr in range(-1, 8):
        for dc in range(-1, 8):
            rr, cc = r + dr, c + dc
            if not (0 <= rr < size and 0 <= cc < size):
                continue
            if dr in (-1, 7) or dc in (-1, 7):
                val = 0                                  # séparateur
            elif dr in (0, 6) or dc in (0, 6):
                val = 1
            elif 2 <= dr <= 4 and 2 <= dc <= 4:
                val = 1
            else:
                val = 0
            mat[rr][cc] = val
            func[rr][cc] = True


def _place_alignment(mat, func, size, cr, cc):
    for dr in range(-2, 3):
        for dc in range(-2, 3):
            rr, c = cr + dr, cc + dc
            ring = max(abs(dr), abs(dc))
            mat[rr][c] = 1 if ring in (0, 2) else 0
            func[rr][c] = True


def _base_matrix(version: int):
    size = 17 + 4 * version
    mat, func = _new_matrix(size)

    _place_finder(mat, func, size, 0, 0)
    _place_finder(mat, func, size, 0, size - 7)
    _place_finder(mat, func, size, size - 7, 0)

    for i in range(8, size - 8):                        # synchro
        bit = 1 - (i % 2)
        mat[6][i] = bit; func[6][i] = True
        mat[i][6] = bit; func[i][6] = True

    centers = _ALIGN[version]
    for cr in centers:
        for cc in centers:
            if (cr < 8 and cc < 8) or (cr < 8 and cc > size - 9) or (
                cr > size - 9 and cc < 8
            ):
                continue
            _place_alignment(mat, func, size, cr, cc)

    mat[size - 8][8] = 1                                 # module sombre
    func[size - 8][8] = True

    for i in range(9):                                   # réserver le format
        if i != 6:
            func[8][i] = True
            func[i][8] = True
    for i in range(8):
        func[8][size - 1 - i] = True
        func[size - 1 - i][8] = True

    if version >= 7:                                     # info de version
        rem = version
        for _ in range(12):
            rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
        vbits = (version << 12) | rem
        for i in range(18):
            bit = (vbits >> i) & 1
            a = size - 11 + i % 3
            b = i // 3
            mat[a][b] = bit; func[a][b] = True
            mat[b][a] = bit; func[b][a] = True

    return mat, func, size


def _place_data(mat, func, size, bits: list[int]):
    i = 0
    col = size - 1
    while col > 0:
        if col == 6:
            col = 5
        for vert in range(size):
            for j in range(2):
                c = col - j
                upward = ((col + 1) & 2) == 0
                row = (size - 1 - vert) if upward else vert
                if not func[row][c]:
                    mat[row][c] = bits[i] if i < len(bits) else 0
                    i += 1
        col -= 2


def _mask_cond(mask: int, row: int, col: int) -> bool:
    if mask == 0:
        return (row + col) % 2 == 0
    if mask == 1:
        return row % 2 == 0
    if mask == 2:
        return col % 3 == 0
    if mask == 3:
        return (row + col) % 3 == 0
    if mask == 4:
        return (row // 2 + col // 3) % 2 == 0
    if mask == 5:
        return (row * col) % 2 + (row * col) % 3 == 0
    if mask == 6:
        return ((row * col) % 2 + (row * col) % 3) % 2 == 0
    return ((row + col) % 2 + (row * col) % 3) % 2 == 0


def _apply_mask(mat, func, size, mask: int):
    for r in range(size):
        for c in range(size):
            if not func[r][c] and _mask_cond(mask, r, c):
                mat[r][c] ^= 1


def _place_format(mat, size, level: str, mask: int):
    data = (_ECL_FORMAT[level] << 3) | mask
    rem = data
    for _ in range(10):
        rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    bits = ((data << 10) | rem) ^ 0x5412

    # La chaîne de 15 bits est placée MSB d'abord : fb[0] est le bit de poids fort.
    fb = [(bits >> (14 - k)) & 1 for k in range(15)]

    for i in range(6):
        mat[8][i] = fb[i]
    mat[8][7] = fb[6]
    mat[8][8] = fb[7]
    mat[7][8] = fb[8]
    for i in range(9, 15):
        mat[14 - i][8] = fb[i]
    for i in range(8):
        mat[size - 1 - i][8] = fb[i]
    for i in range(8, 15):
        mat[8][size - 15 + i] = fb[i]
    mat[size - 8][8] = 1


def _penalty(mat, size) -> int:
    score = 0
    # Règle 1 : séries de 5+ modules identiques (lignes et colonnes).
    for line in (mat, list(zip(*mat))):
        for row in line:
            run_val = row[0]
            run_len = 1
            for v in row[1:]:
                if v == run_val:
                    run_len += 1
                else:
                    if run_len >= 5:
                        score += 3 + (run_len - 5)
                    run_val, run_len = v, 1
            if run_len >= 5:
                score += 3 + (run_len - 5)
    # Règle 2 : blocs 2x2 de même couleur.
    for r in range(size - 1):
        for c in range(size - 1):
            if mat[r][c] == mat[r][c + 1] == mat[r + 1][c] == mat[r + 1][c + 1]:
                score += 3
    # Règle 3 : motifs ressemblant aux finders.
    patt_a = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
    patt_b = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
    cols = list(zip(*mat))
    for line in (mat, cols):
        for row in line:
            row = list(row)
            for i in range(size - 11 + 1 - 0):
                window = row[i:i + 11]
                if window == patt_a or window == patt_b:
                    score += 40
    # Règle 4 : écart de la proportion de modules sombres par rapport à 50 %.
    dark = sum(sum(r) for r in mat)
    total = size * size
    k = (abs(dark * 20 - total * 10) + total - 1) // total  # ceil(|ratio-0.5|*20)
    score += k * 10
    return score


def make(data, level: str = "M", version: int | None = None, mask: int | None = None):
    """Génère la matrice QR (liste de listes de 0/1) pour `data`.

    `data` : str (encodé UTF-8) ou bytes. `level` : L/M/Q/H.
    """
    if isinstance(data, str):
        data = data.encode("utf-8")
    level = level.upper()
    if level not in ("L", "M", "Q", "H"):
        raise ValueError("niveau invalide (L, M, Q ou H)")

    if version is None:
        version = _choose_version(len(data), level)
    elif _total_data_cw(version, level) * 8 < 4 + _cc_bits(version) + 8 * len(data):
        raise ValueError("données trop longues pour cette version")

    codewords = _build_codewords(data, level, version)
    data_bits: list[int] = []
    for cw in codewords:
        for i in range(7, -1, -1):
            data_bits.append((cw >> i) & 1)

    base_mat, func, size = _base_matrix(version)
    _place_data(base_mat, func, size, data_bits)

    masks = [mask] if mask is not None else range(8)
    best = None
    for m in masks:
        cand = [row[:] for row in base_mat]
        _apply_mask(cand, func, size, m)
        _place_format(cand, size, level, m)
        pen = _penalty(cand, size)
        if best is None or pen < best[0]:
            best = (pen, cand)
    return best[1]


# --- Rendu terminal --------------------------------------------------------
def render_lines(matrix, quiet: int = 4, color: bool = True) -> list[str]:
    """Rend la matrice en lignes de texte prêtes à afficher.

    En couleur : demi-blocs (▀) avec fonds explicites noir/blanc → deux rangées
    de modules par ligne, et scannable quel que soit le thème du terminal.
    Sans couleur : blocs pleins ██ / espaces (une rangée par ligne).
    """
    n = len(matrix)
    size = n + 2 * quiet
    grid = [[0] * size for _ in range(size)]
    for r in range(n):
        for c in range(n):
            grid[r + quiet][c + quiet] = matrix[r][c]

    lines: list[str] = []
    if color:
        # fg : 30 noir / 97 blanc ; bg : 40 noir / 107 blanc.
        for y in range(0, size, 2):
            parts = []
            for x in range(size):
                top = grid[y][x]
                bot = grid[y + 1][x] if y + 1 < size else 0
                fg = 30 if top else 97
                bg = 40 if bot else 107
                parts.append(f"\033[{fg};{bg}m▀")
            parts.append("\033[0m")
            lines.append("".join(parts))
    else:
        for row in grid:
            lines.append("".join("██" if v else "  " for v in row))
    return lines
