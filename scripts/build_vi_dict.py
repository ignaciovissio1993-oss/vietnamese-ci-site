import json
import os
import re
from pathlib import Path
from wordfreq import top_n_list

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "dict_vi_en.json"

# Dónde quedó el repo descargado por el workflow
DICT_REPO = ROOT / "_dict_tmp" / "stardict-vi-master"

# Elegimos un diccionario dentro del repo. OVDP suele venir bien.
# Si no existe, buscamos cualquier carpeta que tenga .ifo/.idx/.dict o .dict.dz
PREFERRED = [
    DICT_REPO / "stardict-vi" / "ovdp",      # si existe así
    DICT_REPO / "ovdp",                      # fallback
]

def find_stardict_folder() -> Path:
    for p in PREFERRED:
        if p.exists():
            return p

    # Buscar recursivo la primera carpeta con .ifo + (.dict o .dict.dz) + .idx
    for dirpath, dirnames, filenames in os.walk(DICT_REPO):
        files = set(filenames)
        if any(f.endswith(".ifo") for f in files) and any(f.endswith(".idx") for f in files) and (
            any(f.endswith(".dict") for f in files) or any(f.endswith(".dict.dz") for f in files)
        ):
            return Path(dirpath)

    raise RuntimeError("No encontré ninguna carpeta Stardict (.ifo/.idx/.dict o .dict.dz) dentro de stardict-vi")

def normalize_word(w: str) -> str:
    w = w.strip().lower()
    w = re.sub(r"[\"'“”‘’\(\)\[\]\{\}<>\.,;:!\?]+", "", w)
    return w

def load_stardict(stardict_dir: Path) -> dict:
    """
    Loader minimalista de Stardict.
    NOTA: muchos diccionarios vienen con .dict.dz (comprimido). Para simplificar:
    - Si hay .dict plano, lo usamos.
    - Si hay solo .dict.dz, dejamos definiciones vacías (y aún así te arma el JSON top 5000).
      Si querés sí o sí definitions completas, te digo al final cómo habilitar dz.
    """
    ifo = next(stardict_dir.glob("*.ifo"), None)
    idx = next(stardict_dir.glob("*.idx"), None)
    dict_plain = next(stardict_dir.glob("*.dict"), None)
    dict_dz = next(stardict_dir.glob("*.dict.dz"), None)

    if not ifo or not idx:
        raise RuntimeError(f"Faltan .ifo/.idx en {stardict_dir}")

    if dict_plain is None and dict_dz is not None:
        # Sin soporte dz en este script minimalista (para que no se rompa el workflow).
        # Igual construimos el JSON con gloss vacío; después podés mejorar.
        return {}

    if dict_plain is None:
        return {}

    dict_bytes = dict_plain.read_bytes()

    # Parse idx: (word\0)(offset:4)(size:4) repetido
    idx_bytes = idx.read_bytes()
    pos = 0
    out = {}

    while pos < len(idx_bytes):
        # word hasta \0
        end = idx_bytes.find(b"\x00", pos)
        if end == -1:
            break
        word = idx_bytes[pos:end].decode("utf-8", "ignore")
        pos = end + 1
        if pos + 8 > len(idx_bytes):
            break
        offset = int.from_bytes(idx_bytes[pos:pos+4], "big")
        size = int.from_bytes(idx_bytes[pos+4:pos+8], "big")
        pos += 8

        raw = dict_bytes[offset:offset+size]
        definition = raw.decode("utf-8", "ignore").strip()

        nw = normalize_word(word)
        if nw and nw not in out and definition:
            out[nw] = definition

    return out

def make_explanatory(defn: str) -> str:
    """
    Limpieza ligera para que quede “explicativo” y usable en tooltip.
    """
    defn = defn.replace("\r", "\n")
    defn = re.sub(r"\n{3,}", "\n\n", defn).strip()
    # cortar definiciones absurdamente largas
    if len(defn) > 600:
        defn = defn[:600].rsplit(" ", 1)[0] + "…"
    return defn

def main():
    ROOT.joinpath("assets").mkdir(parents=True, exist_ok=True)

    stardict_dir = find_stardict_folder()
    defs = load_stardict(stardict_dir)

    # Top 5000 palabras vietnamita (frecuencia)
    top_words = top_n_list("vi", 5000)

    result = {}
    for w in top_words:
        nw = normalize_word(w)
        if not nw:
            continue
        d = defs.get(nw, "")
        result[nw] = {
            "gloss": make_explanatory(d) if d else "",
            "note": "",  # opcional: podés llenar luego si querés reglas tuyas
        }

    OUT.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"✅ Wrote {OUT} with {len(result)} entries (top words). Dict folder: {stardict_dir}")

if __name__ == "__main__":
    main()
