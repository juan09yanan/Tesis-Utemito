"""
Extraccion de datos de contacto (correos, telefonos/extensiones, enlaces) a
partir de texto plano. Se usa en dos momentos:
- Al indexar un documento (backend/rag/ingest.py): lo que se encuentra se
  guarda en la base de datos SQLite (backend/db.py).
- Nunca al responder: el buho SOLO lee lo que ya quedo guardado en la base
  de datos (backend/rag/llm.py), nunca vuelve a inventar ni a adivinar nada.
"""
import re

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>()\[\]\"']+", re.IGNORECASE)

# Enlaces de "edicion" de Google Docs/Sheets/Slides: quedan como residuo cuando
# un PDF se exporta desde Google Docs, pero son privados (requieren permiso del
# autor) y nunca funcionan para un tercero. Nunca son un dato de contacto util.
URL_RUIDO_RE = re.compile(
    r"docs\.google\.com/(?:document|spreadsheets|presentation)/.*?/edit"
    r"|drive\.google\.com/.*?/edit",
    re.IGNORECASE,
)
PHONE_RE = re.compile(
    r"(?:\+?593[\s.\-]?)?(?:\(?0?\d{1,2}\)?[\s.\-]?)?\d{3}[\s.\-]?\d{4}"
    r"|ext(?:\.|ensi[oó]n)?\s*\.?\s*\d{2,5}",
    re.IGNORECASE,
)


def extraer_contactos(texto: str) -> list[dict]:
    """Devuelve [{"tipo": "correo"|"telefono"|"enlace", "valor": str}, ...]
    con los datos de contacto encontrados literalmente en el texto."""
    items: list[dict] = []

    for correo in sorted(set(EMAIL_RE.findall(texto))):
        items.append({"tipo": "correo", "valor": correo})

    enlaces = {u.rstrip(".,);:]") for u in URL_RE.findall(texto)}
    for enlace in sorted(enlaces):
        if URL_RUIDO_RE.search(enlace):
            continue
        items.append({"tipo": "enlace", "valor": enlace})

    telefonos = []
    for m in PHONE_RE.findall(texto):
        m = m.strip()
        if not m:
            continue
        digitos = re.sub(r"\D", "", m)
        if "ext" in m.lower() or len(digitos) >= 7:
            telefonos.append(m)
    for tel in sorted(set(telefonos)):
        items.append({"tipo": "telefono", "valor": tel})

    return items
