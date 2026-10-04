"""
Lee los documentos de la carpeta `documentos/` (matricula, becas, certificados,
etc.), los divide en fragmentos y los indexa en ChromaDB para que el buho
pueda usarlos como base de conocimiento (RAG - Retrieval Augmented Generation).

Expone funciones reutilizables (index_document, remove_document, reindex_all,
indexed_sources) que usa tanto el modo linea de comandos como el panel web de
administracion (backend/admin.py).

Ademas de indexar el texto en ChromaDB (busqueda semantica), extrae los datos
de contacto (correos, telefonos/extensiones, enlaces) de cada documento y los
guarda estructurados en la base de datos SQLite (backend/db.py), para que el
buho los pueda usar al responder sin volver a escanear texto cada vez.

Modo linea de comandos (reindexa todo desde cero):
    python -m backend.rag.ingest
"""
import hashlib
import re
from pathlib import Path

from docx import Document as DocxDocument
from pypdf import PdfReader

from backend import config, db
from backend.rag.extract import extraer_contactos
from backend.rag.store import get_collection, reset_collection

SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf", ".docx"}

# Pistas de que un fragmento contiene datos de contacto (correo, telefono, enlace).
# Un fragmento con datos de contacto NUNCA se parte por la mitad, para no romper
# un correo o un numero de telefono entre dos fragmentos.
CONTACT_HINT_RE = re.compile(
    r"(@|https?://|www\.|\bext\b|\bextensi[oó]n\b|\+?\d[\d\s().\-]{6,}\d)",
    re.IGNORECASE,
)

CHUNK_SIZE = 900   # tamano objetivo de cada fragmento (caracteres)
MIN_SIZE = 250     # por debajo de esto, seguimos acumulando aunque cambie de seccion


def read_txt(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def read_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def read_docx(path: Path) -> str:
    doc = DocxDocument(str(path))
    return "\n".join(p.text for p in doc.paragraphs)


READERS = {
    ".txt": read_txt,
    ".md": read_txt,
    ".pdf": read_pdf,
    ".docx": read_docx,
}


def read_document(path: Path) -> str:
    """Extrae el texto plano de un documento segun su extension."""
    ext = path.suffix.lower()
    if ext not in READERS:
        raise ValueError(f"Formato no soportado: {ext}")
    return READERS[ext](path)


# ---------- Troceado (chunking) que respeta la estructura del documento ----------

def _bloques(text: str) -> list[str]:
    """Parte el texto en bloques logicos: cada encabezado Markdown y cada
    parrafo (separado por linea en blanco) es un bloque independiente."""
    bloques: list[str] = []
    buffer: list[str] = []

    def cerrar():
        if buffer:
            b = "\n".join(buffer).strip()
            if b:
                bloques.append(b)
            buffer.clear()

    for linea in text.replace("\r\n", "\n").split("\n"):
        s = linea.strip()
        if not s:
            cerrar()
            continue
        if s.startswith("#"):
            cerrar()
            bloques.append(s)
            continue
        buffer.append(s)
    cerrar()
    return bloques


def _titulo(bloque: str) -> str:
    return bloque.lstrip("#").strip()


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE) -> list[dict]:
    """
    Divide el texto respetando su estructura:
    - agrupa cada seccion (encabezado + parrafos) hasta ~chunk_size caracteres,
    - NUNCA parte un bloque que contiene datos de contacto (correos, telefonos, enlaces),
    - arrastra el titulo de la seccion al inicio de cada fragmento para no perder contexto.

    Devuelve una lista de dicts: {"texto", "seccion", "contacto"}.
    """
    bloques = _bloques(text)
    if not bloques:
        return []

    fragmentos: list[dict] = []
    seccion = ""
    actual = ""

    def emitir(txt: str, sec: str):
        txt = txt.strip()
        if txt:
            fragmentos.append(
                {"texto": txt, "seccion": sec, "contacto": bool(CONTACT_HINT_RE.search(txt))}
            )

    for bloque in bloques:
        if bloque.startswith("#"):
            if len(actual) >= MIN_SIZE:
                emitir(actual, seccion)
                actual = ""
            seccion = _titulo(bloque)
            actual = f"{actual}\n{bloque}".strip() if actual else bloque
            continue

        candidato = f"{actual}\n\n{bloque}".strip() if actual else bloque
        if len(candidato) <= chunk_size or not actual:
            actual = candidato
        else:
            emitir(actual, seccion)
            prefijo = f"## {seccion}\n" if seccion else ""
            actual = f"{prefijo}{bloque}"

        # Bloque unico demasiado grande y sin datos de contacto: se trocea por tamano.
        if len(actual) > chunk_size * 1.6 and not CONTACT_HINT_RE.search(actual):
            duro, actual = actual, ""
            paso = chunk_size - 150
            for i in range(0, len(duro), paso):
                emitir(duro[i : i + chunk_size], seccion)

    emitir(actual, seccion)
    return fragmentos


def _chunk_id(nombre: str, i: int) -> str:
    return hashlib.md5(f"{nombre}-{i}".encode("utf-8")).hexdigest()


def remove_document(nombre: str) -> None:
    """Elimina de la base vectorial y de la base de contactos todos los datos de un documento."""
    collection = get_collection()
    collection.delete(where={"fuente": nombre})
    db.eliminar_contactos_documento(nombre)


def index_document(path: Path) -> int:
    """
    Indexa (o reindexa) un unico documento y devuelve cuantos fragmentos genero.
    Antes de insertar borra los fragmentos y contactos previos de ese mismo
    archivo, para que al reemplazar un documento no queden datos viejos
    "huerfanos" en ninguna de las dos bases.
    """
    path = Path(path)
    text = read_document(path)
    fragmentos = chunk_text(text)

    remove_document(path.name)
    if not fragmentos:
        return 0

    collection = get_collection()
    ids, documents, metadatas = [], [], []
    contactos_doc: list[dict] = []
    for i, frag in enumerate(fragmentos):
        ids.append(_chunk_id(path.name, i))
        documents.append(frag["texto"])
        metadatas.append(
            {
                "fuente": path.name,
                "chunk": i,
                "seccion": frag["seccion"],
                "contacto": frag["contacto"],
            }
        )
        for contacto in extraer_contactos(frag["texto"]):
            contactos_doc.append({**contacto, "seccion": frag["seccion"]})

    collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
    db.reemplazar_contactos_documento(path.name, contactos_doc)
    return len(fragmentos)


def indexed_sources() -> dict[str, int]:
    """Devuelve {nombre_de_archivo: numero_de_fragmentos} de lo que hay indexado."""
    collection = get_collection()
    total = collection.count()
    if total == 0:
        return {}

    data = collection.get(include=["metadatas"])
    conteo: dict[str, int] = {}
    for meta in data.get("metadatas", []):
        fuente = (meta or {}).get("fuente", "desconocida")
        conteo[fuente] = conteo.get(fuente, 0) + 1
    return conteo


def reindex_all() -> dict[str, int]:
    """
    Borra la coleccion y vuelve a indexar todos los documentos de la carpeta.
    Devuelve {nombre_de_archivo: numero_de_fragmentos}  (-1 si hubo error).
    """
    docs_path = Path(config.DOCUMENTOS_PATH)
    if not docs_path.exists():
        return {}

    files = sorted(
        f for f in docs_path.rglob("*") if f.suffix.lower() in SUPPORTED_EXTENSIONS
    )

    reset_collection()
    db.eliminar_todos_los_contactos()
    resultado: dict[str, int] = {}
    for file_path in files:
        try:
            resultado[file_path.name] = index_document(file_path)
        except Exception as exc:  # noqa: BLE001 - queremos reportar y seguir
            resultado[file_path.name] = -1
            print(f"  [ERROR] {file_path.name}: {exc}")
    return resultado


def main():
    docs_path = Path(config.DOCUMENTOS_PATH)
    if not docs_path.exists():
        print(f"No existe la carpeta de documentos: {docs_path}")
        return

    files = sorted(
        f for f in docs_path.rglob("*") if f.suffix.lower() in SUPPORTED_EXTENSIONS
    )
    if not files:
        print(f"No se encontraron documentos soportados en {docs_path}")
        print(f"Formatos aceptados: {', '.join(sorted(SUPPORTED_EXTENSIONS))}")
        return

    print(f"Reindexando {len(files)} documento(s) desde cero...\n")
    resultado = reindex_all()

    total = 0
    for nombre, n in resultado.items():
        if n < 0:
            print(f"  [ERROR] {nombre}")
        else:
            print(f"  - {nombre}: {n} fragmento(s)")
            total += n

    print(f"\nListo. {total} fragmentos indexados en la base vectorial ({config.CHROMA_PATH}).")
    print("Ya puedes iniciar el servidor con: uvicorn backend.main:app --reload")


if __name__ == "__main__":
    main()
