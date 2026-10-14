import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
# Esfuerzo de razonamiento de los modelos gpt-oss: "low" responde mucho mas rapido.
REASONING_EFFORT = os.getenv("REASONING_EFFORT", "low")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")

CHROMA_PATH = os.getenv("CHROMA_PATH", str(BASE_DIR / "chroma_db"))
DOCUMENTOS_PATH = os.getenv("DOCUMENTOS_PATH", str(BASE_DIR / "documentos"))
COLLECTION_NAME = "utm_fci_conocimiento"

# Base de datos SQLite con los datos de contacto (correos, telefonos, enlaces)
# extraidos de los documentos. Un solo archivo local, sin instalar nada.
DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "utemito_data.db"))

TOP_K = int(os.getenv("TOP_K", "3"))

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

# Token para proteger el panel de administracion (/admin y /api/admin/*).
# Si se deja vacio, la API de administracion RECHAZA todas las peticiones
# (falla cerrado). Solo para desarrollo local se puede abrir explicitamente con
# ALLOW_INSECURE_ADMIN=true. NUNCA lo actives en produccion.
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
ALLOW_INSECURE_ADMIN = os.getenv("ALLOW_INSECURE_ADMIN", "").strip().lower() in ("1", "true", "yes", "si")

# Tamano maximo por archivo subido desde el panel (MB).
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))

# ---------- Calidad de la recuperacion (RAG) ----------

# Distancia coseno maxima (0 = identico, 2 = opuesto) para aceptar un fragmento
# recuperado por similitud. Los que la superen se descartan, asi el LLM no recibe
# contexto sin relacion con la pregunta. 0.85 se calibro con evaluacion/run_eval.py
# para el modelo de embeddings por defecto (ver evaluacion/). Vacio = sin umbral.
_max_dist = os.getenv("MAX_DISTANCE", "0.85").strip()
MAX_DISTANCE = float(_max_dist) if _max_dist else None

# Reescribe la pregunta usando el historial de la conversacion antes de buscar,
# para que preguntas de seguimiento ("¿y cuando es?") encuentren su contexto.
REWRITE_QUERY = os.getenv("REWRITE_QUERY", "true").strip().lower() in ("1", "true", "yes", "si")
REWRITE_MODEL = os.getenv("REWRITE_MODEL", "") or GROQ_MODEL

# ---------- Seguridad del chat ----------

# Maximo de consultas al chat por IP y minuto (0 = sin limite). Frena abusos y
# automatizacion; ademas protege la cuota gratuita de Groq.
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "20"))
