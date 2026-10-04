"""
Base de datos SQLite (un solo archivo local, sin instalar nada) donde se
guardan estructurados los datos de contacto (correos, telefonos/extensiones,
enlaces) que se extraen de cada documento al indexarlo.

ChromaDB ya guarda los fragmentos de texto para la busqueda semantica (RAG);
esta base aparte guarda SOLO los datos de contacto ya extraidos, para que:
- el panel de administracion pueda mostrarlos (verificar que se detectaron bien),
- y el buho, al responder, los lea directo de aqui en vez de tener que volver
  a escanear texto con expresiones regulares en cada pregunta.
"""
import sqlite3
from pathlib import Path

from backend import config

DB_PATH = Path(config.DB_PATH)


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS contactos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            documento TEXT NOT NULL,
            tipo TEXT NOT NULL,
            valor TEXT NOT NULL,
            seccion TEXT DEFAULT '',
            UNIQUE(documento, tipo, valor, seccion)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_contactos_documento ON contactos(documento)")
    conn.commit()
    conn.close()


def reemplazar_contactos_documento(documento: str, contactos: list[dict]) -> None:
    """Borra los contactos previos de ese documento e inserta los nuevos.
    Se llama cada vez que se (re)indexa un documento."""
    conn = get_connection()
    conn.execute("DELETE FROM contactos WHERE documento = ?", (documento,))
    if contactos:
        conn.executemany(
            "INSERT OR IGNORE INTO contactos (documento, tipo, valor, seccion) VALUES (?, ?, ?, ?)",
            [(documento, c["tipo"], c["valor"], c.get("seccion", "") or "") for c in contactos],
        )
    conn.commit()
    conn.close()


def eliminar_contactos_documento(documento: str) -> None:
    conn = get_connection()
    conn.execute("DELETE FROM contactos WHERE documento = ?", (documento,))
    conn.commit()
    conn.close()


def eliminar_todos_los_contactos() -> None:
    conn = get_connection()
    conn.execute("DELETE FROM contactos")
    conn.commit()
    conn.close()


def listar_contactos(documentos: list[str] | None = None) -> list[dict]:
    """Lista los contactos guardados. Si se pasa `documentos`, filtra solo
    los de esas fuentes (usado al armar el contexto de una respuesta).
    Una lista vacia ([]) devuelve [] (nunca "todos"); solo None trae todos."""
    if documentos is not None and len(documentos) == 0:
        return []

    conn = get_connection()
    if documentos:
        placeholders = ",".join("?" for _ in documentos)
        cur = conn.execute(
            f"SELECT documento, tipo, valor, seccion FROM contactos "
            f"WHERE documento IN ({placeholders}) ORDER BY documento, tipo, valor",
            documentos,
        )
    else:
        cur = conn.execute(
            "SELECT documento, tipo, valor, seccion FROM contactos ORDER BY documento, tipo, valor"
        )
    filas = [dict(r) for r in cur.fetchall()]
    conn.close()
    return filas


init_db()
