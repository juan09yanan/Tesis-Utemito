import os
import tempfile
from pathlib import Path

# Aisla la base SQLite y Chroma de los tests (db.py hace init_db() al importarse).
_tmp = tempfile.mkdtemp(prefix="utemito-tests-")
os.environ["DB_PATH"] = str(Path(_tmp) / "test.db")
os.environ["CHROMA_PATH"] = str(Path(_tmp) / "chroma")
os.environ["DOCUMENTOS_PATH"] = str(Path(_tmp) / "docs")
os.environ.setdefault("GROQ_API_KEY", "test-key")
