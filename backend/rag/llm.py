"""
Logica de generacion de respuestas: recupera contexto relevante de ChromaDB
(retrieval) y se lo pasa al modelo de lenguaje de Groq junto con la pregunta
del estudiante para que "Utemito" (el buho) genere una respuesta (generation).

El buho responde UNICAMENTE con la informacion del contexto recuperado. Los
datos de contacto (correos, telefonos, extensiones, enlaces) NO se vuelven a
adivinar aqui: se leen ya extraidos de la base de datos SQLite (backend/db.py),
donde quedaron guardados al indexar cada documento (backend/rag/ingest.py).
"""
import logging

from groq import Groq

from backend import config, db
from backend.rag.extract import extraer_contactos
from backend.rag.store import get_collection

logger = logging.getLogger("utemito.rag")

_client: Groq | None = None

REWRITE_PROMPT = """Reformula la ULTIMA pregunta del estudiante para que sea una consulta de busqueda autonoma, usando la conversacion previa solo para resolver referencias (\"eso\", \"y cuando es?\", \"el segundo\").

Reglas:
- Responde UNICAMENTE con la consulta reformulada, en espanol, en una sola linea, sin comillas ni explicaciones.
- Conserva todos los terminos clave y NO agregues informacion que no este en la conversacion.
- Si la pregunta ya es autonoma, devuelvela igual."""

SYSTEM_PROMPT = """Eres "Utemito", el buho mascota y asistente virtual de la Universidad Tecnica de Manabi (UTM).

Tu trabajo es ayudar a los estudiantes con sus dudas sobre tramites universitarios: matricula, certificados, becas, practicas preprofesionales, titulacion, homologacion/convalidacion, movilidad de carrera, y temas academicos o administrativos de la universidad.

Reglas que debes seguir SIEMPRE:
- Responde SIEMPRE en espanol, de forma amable, cercana, cordial y clara, como un companero mayor que orienta a un estudiante nuevo.
- Basate EXCLUSIVAMENTE en el CONTEXTO que aparece mas abajo. NO uses conocimiento externo ni supuestos. NUNCA inventes fechas, requisitos, montos, correos, telefonos, enlaces ni procedimientos que no esten en el contexto.
- El sistema de busqueda a veces recupera fragmentos que NO tienen relacion real con la pregunta (son solo los "mas parecidos" de lo que hay disponible, no necesariamente relevantes). Evalua tu mismo si el CONTEXTO responde de verdad la pregunta especifica del estudiante antes de usarlo.
- Si la respuesta especifica NO esta en el contexto (o el contexto es sobre un tramite distinto al que se pregunto), dilo con honestidad ("No tengo esa informacion exacta en mis documentos") y sugiere al estudiante acudir a Secretaria Academica o a Bienestar Estudiantil de la UTM, mencionandolos SOLO POR NOMBRE. En ese caso NO incluyas NINGUN correo, telefono, extension ni enlace (URL) aunque aparezcan en el contexto: pertenecen a un tramite distinto y compartirlos confundiria al estudiante.
- Solo cuando el CONTEXTO SI responde la pregunta especifica, y contiene correos electronicos, numeros de telefono, extensiones o enlaces (URLs) relacionados con ESE tramite, incluyelos en tu respuesta escritos EXACTAMENTE como aparecen en el contexto, sin cambiar ni un caracter. NUNCA inventes ni uses datos de contacto que no esten en el contexto, y nunca los uses "por si sirven" si no son del tema preguntado.
- Se conciso y organizado: cuando expliques un procedimiento o unos requisitos, usa pasos numerados simples (1., 2., 3.) o listas con guion (-).
- Tu respuesta se muestra como texto en una burbuja de chat. NO uses formato Markdown (nada de "###", "**negritas**", tablas con "|", ni bloques de codigo). Escribe en parrafos y listas simples. Los correos y enlaces si van tal cual, en texto normal.
- Puedes saludar y conversar brevemente de forma amigable, pero tu proposito principal es orientar sobre tramites universitarios de la UTM.
"""


def get_client() -> Groq:
    global _client
    if _client is None:
        if not config.GROQ_API_KEY:
            raise RuntimeError(
                "Falta configurar GROQ_API_KEY. Copia .env.example a .env y agrega tu "
                "clave gratuita generada en https://console.groq.com"
            )
        _client = Groq(api_key=config.GROQ_API_KEY)
    return _client


def _fetch_por_fuente(collection, nombre: str) -> list[dict]:
    """Trae todos los fragmentos de un documento concreto (por nombre de archivo)."""
    try:
        data = collection.get(where={"fuente": nombre}, include=["documents", "metadatas"])
    except Exception:
        return []
    salida = []
    for d, m in zip(data.get("documents", []), data.get("metadatas", [])):
        m = m or {}
        salida.append(
            {
                "texto": d,
                "fuente": m.get("fuente", nombre),
                "seccion": m.get("seccion", ""),
                "distancia": None,
            }
        )
    return salida


def _turnos_validos(history: list[dict] | None, n: int = 6) -> list[dict]:
    turnos = []
    for turn in (history or [])[-n:]:
        if turn.get("role") in ("user", "assistant") and turn.get("content"):
            turnos.append({"role": turn["role"], "content": turn["content"]})
    return turnos


def rewrite_query(question: str, history: list[dict] | None) -> str:
    """Convierte una pregunta de seguimiento en una consulta autonoma usando el
    historial. Sin historial, o si algo falla, devuelve la pregunta original."""
    if not config.REWRITE_QUERY:
        return question
    turnos = _turnos_validos(history, n=4)
    if not turnos:
        return question

    conversacion = "\n".join(
        f"{'Estudiante' if t['role'] == 'user' else 'Utemito'}: {t['content'][:500]}" for t in turnos
    )
    try:
        completion = get_client().chat.completions.create(
            model=config.REWRITE_MODEL,
            messages=[
                {"role": "system", "content": REWRITE_PROMPT},
                {
                    "role": "user",
                    "content": f"CONVERSACION PREVIA:\n{conversacion}\n\nULTIMA PREGUNTA:\n{question}",
                },
            ],
            temperature=0,
            max_tokens=200,
        )
        texto = (completion.choices[0].message.content or "").strip().splitlines()
        reescrita = texto[0].strip().strip('"') if texto else ""
        # Salvaguarda: una reescritura vacia o desproporcionada no es fiable.
        if reescrita and len(reescrita) <= max(300, len(question) * 4):
            return reescrita
    except Exception:  # noqa: BLE001 - la reescritura es una mejora opcional
        logger.warning("No se pudo reescribir la consulta; se usa la original.", exc_info=True)
    return question


def filtrar_por_distancia(chunks: list[dict], max_distance: float | None) -> list[dict]:
    """Descarta los fragmentos recuperados por similitud cuya distancia supera el
    umbral. Los fragmentos sin distancia (fuentes siempre incluidas) se conservan.
    Con max_distance=None no filtra nada."""
    if max_distance is None:
        return chunks
    return [c for c in chunks if c.get("distancia") is None or c["distancia"] <= max_distance]


def retrieve_context(question: str, top_k: int | None = None, max_distance: float | None = None) -> list[dict]:
    collection = get_collection()
    total = collection.count()
    if total == 0:
        return []

    k = top_k or config.TOP_K
    results = collection.query(
        query_texts=[question],
        n_results=min(k, total),
        include=["documents", "metadatas", "distances"],
    )

    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]
    dists = (results.get("distances") or [[None] * len(docs)])[0]

    chunks: list[dict] = []
    vistos: set[str] = set()
    for d, m, dist in zip(docs, metas, dists):
        m = m or {}
        if d in vistos:
            continue
        vistos.add(d)
        chunks.append(
            {
                "texto": d,
                "fuente": m.get("fuente", "desconocida"),
                "seccion": m.get("seccion", ""),
                "distancia": dist,
            }
        )

    chunks = filtrar_por_distancia(chunks, max_distance)

    # Incluye siempre las fuentes marcadas como imprescindibles (p. ej. la de
    # contactos de la facultad), para que el buho siempre pueda derivar al
    # estudiante a la dependencia correcta con datos reales.
    for nombre in config.ALWAYS_INCLUDE_SOURCES:
        for extra in _fetch_por_fuente(collection, nombre):
            if extra["texto"] not in vistos:
                vistos.add(extra["texto"])
                chunks.append(extra)

    return chunks


def build_context_block(chunks: list[dict]) -> str:
    if not chunks:
        return "(No se encontro informacion relevante en la base de conocimiento para esta pregunta.)"

    partes = []
    for c in chunks:
        encab = f"[Fuente: {c['fuente']}"
        if c.get("seccion"):
            encab += f" | Seccion: {c['seccion']}"
        encab += "]"
        partes.append(f"{encab}\n{c['texto']}")
    bloque = "\n\n---\n\n".join(partes)

    # Los datos de contacto NO se vuelven a extraer del texto: se leen ya
    # guardados en la base de datos SQLite, filtrados solo a los documentos
    # que aparecen en este contexto (nunca de otros documentos).
    fuentes = sorted({c["fuente"] for c in chunks})
    contactos = db.listar_contactos(documentos=fuentes)

    lineas = []
    for tipo, etiqueta in (("correo", "Correos"), ("telefono", "Telefonos/extensiones"), ("enlace", "Enlaces")):
        valores = sorted({c["valor"] for c in contactos if c["tipo"] == tipo})
        if valores:
            lineas.append(f"{etiqueta}: " + " ; ".join(valores))

    if lineas:
        bloque += (
            "\n\n---\n\nDATOS DE CONTACTO (extraidos de los documentos y guardados en la "
            "base de datos; si ayudan a responder, reproducelos EXACTAMENTE, sin modificarlos):\n- "
            + "\n- ".join(lineas)
        )
    return bloque


def ask_buho(question: str, history: list[dict] | None = None) -> dict:
    consulta = rewrite_query(question, history)
    chunks = retrieve_context(consulta, max_distance=config.MAX_DISTANCE)
    context_block = build_context_block(chunks)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    messages.extend(_turnos_validos(history))

    user_content = (
        f"CONTEXTO RECUPERADO:\n{context_block}\n\n"
        f"PREGUNTA DEL ESTUDIANTE:\n{question}"
    )
    messages.append({"role": "user", "content": user_content})

    client = get_client()
    completion = client.chat.completions.create(
        model=config.GROQ_MODEL,
        messages=messages,
        temperature=0.2,
        max_tokens=700,
    )

    respuesta = completion.choices[0].message.content or ""
    fuentes = sorted({c["fuente"] for c in chunks})

    # Extrae enlaces, correos y telefonos/extensiones mencionados en la respuesta
    # y los enriquece con metadatos de SQLite si provienen de las fuentes usadas.
    contactos_db = {c["valor"].lower(): c for c in db.listar_contactos(documentos=fuentes)}
    contactos_respuesta = []
    for item in extraer_contactos(respuesta):
        meta = contactos_db.get(item["valor"].lower(), {})
        contactos_respuesta.append(
            {
                "documento": meta.get("documento", fuentes[0] if len(fuentes) == 1 else ""),
                "tipo": item["tipo"],
                "valor": item["valor"],
                "seccion": meta.get("seccion", ""),
            }
        )

    return {"respuesta": respuesta, "fuentes": fuentes, "contactos": contactos_respuesta}
