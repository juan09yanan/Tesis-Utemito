"""
Evalua la RECUPERACION del RAG (sin llamar al LLM de respuesta) para poder medir
si cada cambio (umbral de distancia, reescritura de consulta...) mejora o empeora.

Metricas:
- hit@k  (preguntas en alcance / seguimiento): algun fragmento recuperado contiene
  alguna de las `claves` esperadas.
- rechazo (fuera de alcance): proporcion de preguntas para las que NO queda ningun
  fragmento de busqueda por similitud (el buho respondera "no tengo esa informacion").
- ruido: media de fragmentos por pregunta fuera de alcance que llegan al LLM.

Uso (desde la raiz del proyecto, con la base ya indexada):
    python -m evaluacion.run_eval                      # config actual (.env)
    python -m evaluacion.run_eval --max-distance 0.9   # fuerza un umbral
    python -m evaluacion.run_eval --sweep              # barrido de umbrales
    python -m evaluacion.run_eval --no-rewrite         # sin reescritura (por defecto usa REWRITE_QUERY)
"""
import argparse
import json
import sys
from pathlib import Path

from backend import config
from backend.rag.llm import retrieve_context, rewrite_query

PREGUNTAS = Path(__file__).with_name("preguntas.json")


def _norm(t: str) -> str:
    return t.lower()


def evaluar(max_distance, rewrite: bool, verbose: bool = False) -> dict:
    casos = json.loads(PREGUNTAS.read_text(encoding="utf-8"))
    config.REWRITE_QUERY = rewrite
    aciertos = total_pos = 0
    rechazos = total_neg = 0
    ruido = 0
    detalle = []
    for c in casos:
        consulta = rewrite_query(c["pregunta"], c.get("historial")) if rewrite else c["pregunta"]
        chunks = retrieve_context(consulta, max_distance=max_distance)
        similares = [x for x in chunks if x["distancia"] is not None]
        dmin = min((x["distancia"] for x in similares), default=None)
        if c["tipo"] == "fuera_de_alcance":
            total_neg += 1
            rechazos += 1 if not similares else 0
            ruido += len(similares)
            ok = not similares
        else:
            total_pos += 1
            texto = _norm(" ".join(x["texto"] for x in chunks))
            ok = any(_norm(k) in texto for k in c["claves"])
            aciertos += 1 if ok else 0
        detalle.append((c["id"], c["tipo"], ok, dmin, len(similares), consulta))
    if verbose:
        for id_, tipo, ok, dmin, n, consulta in detalle:
            d = f"{dmin:.3f}" if dmin is not None else "  -  "
            print(f"  [{'OK ' if ok else 'FAIL'}] {id_:9} {tipo:16} dmin={d} n={n}  q={consulta[:60]}")
    return {
        "hit@k": aciertos / total_pos if total_pos else 0.0,
        "rechazo": rechazos / total_neg if total_neg else 0.0,
        "ruido": ruido / total_neg if total_neg else 0.0,
        "pos": total_pos, "neg": total_neg,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-distance", type=float, default=None)
    ap.add_argument("--no-rewrite", action="store_true")
    ap.add_argument("--sweep", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    rewrite = (config.REWRITE_QUERY and not a.no_rewrite)
    if rewrite and not config.GROQ_API_KEY:
        print("Aviso: sin GROQ_API_KEY no se puede reescribir; se evalua sin reescritura.", file=sys.stderr)
        rewrite = False

    if a.sweep:
        print(f"{'umbral':>8} {'hit@k':>7} {'rechazo':>8} {'ruido':>6}")
        for th in [None, 1.2, 1.1, 1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6]:
            r = evaluar(th, rewrite)
            print(f"{str(th):>8} {r['hit@k']:>7.0%} {r['rechazo']:>8.0%} {r['ruido']:>6.1f}")
        return
    th = a.max_distance if a.max_distance is not None else config.MAX_DISTANCE
    r = evaluar(th, rewrite, verbose=a.verbose)
    print(f"umbral={th} rewrite={rewrite} | hit@k={r['hit@k']:.0%} ({r['pos']} casos) "
          f"rechazo={r['rechazo']:.0%} ({r['neg']} casos) ruido={r['ruido']:.1f}")


if __name__ == "__main__":
    main()
