import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")

CHROMA_PATH = os.getenv("CHROMA_PATH", str(BASE_DIR / "chroma_db"))
DOCUMENTOS_PATH = os.getenv("DOCUMENTOS_PATH", str(BASE_DIR / "documentos"))
COLLECTION_NAME = "utm_fci_conocimiento"

# Base de datos SQLite con los datos de contacto (correos, telefonos, enlaces)
# extraidos de los documentos. Un solo archivo local, sin instalar nada.
DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "utemito_data.db"))

TOP_K = int(os.getenv("TOP_K", "5"))

# Documentos que SIEMPRE se anaden al contexto (ademas de los recuperados por
# similitud), separados por coma. Vacio por defecto: el buho responde solo con
# los fragmentos que recupere. Si tienes un documento con los contactos oficiales
# y quieres que este siempre disponible, pon aqui su nombre de archivo, p. ej.:
#   ALWAYS_INCLUDE_SOURCES=contactos.md
ALWAYS_INCLUDE_SOURCES = [
    s.strip()
    for s in os.getenv("ALWAYS_INCLUDE_SOURCES", "").split(",")
    if s.strip()
]

# Token opcional para proteger el panel de administracion (/admin y /api/admin/*).
# Si se deja vacio, el panel queda abierto (util en local; NO recomendado en produccion).
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

# Tamano maximo por archivo subido desde el panel (MB).
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))
