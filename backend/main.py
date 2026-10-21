"""
Punto de entrada de la aplicacion. Levanta la API (FastAPI) y sirve el
frontend (HTML/CSS/JS) donde el estudiante conversa con "Utemito", el buho.

Ejecutar con:
    uvicorn backend.main:app --reload
"""
import hashlib
import logging
import re
from pathlib import Path

import edge_tts
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from backend.admin import router as admin_router
from backend.rag.llm import ask_buho
from backend.schemas import ChatRequest, ChatResponse, TTSRequest

logger = logging.getLogger("utemito")
_TTS_CACHE: dict[str, bytes] = {}
# Voz neuronal de Utemito: calida, amigable y con ritmo agil
TTS_VOICE = "es-EC-LuisNeural"
TTS_RATE = "+30%"
TTS_PITCH = "+2Hz"

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="Utemito - Asistente Virtual UTM")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def sin_cache(request, call_next):
    """Evita que el navegador se quede con una version vieja del HTML/JS/CSS
    en cache (fuente de bugs confusos tipo 'no aparece' al editar el frontend
    durante el desarrollo). Solo los recursos pesados y estables (animaciones e
    imagenes) se cachean una semana; la API y el HTML/JS/CSS nunca."""
    response = await call_next(request)
    if request.url.path.startswith(("/animaciones/", "/assets/", "/logo.jpeg", "/js/three.min.js")):
        response.headers["Cache-Control"] = "public, max-age=3600"
    else:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response

app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")
app.mount("/animaciones", StaticFiles(directory=FRONTEND_DIR / "animaciones"), name="animaciones")


app.include_router(admin_router)


@app.get("/logo.jpeg")
def logo_image():
    return FileResponse(FRONTEND_DIR / "logo.jpeg")


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/admin")
def admin_panel():
    return FileResponse(FRONTEND_DIR / "admin.html")


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacio")

    try:
        history = [turn.model_dump() for turn in req.history]
        result = ask_buho(req.message, history=history)
        return ChatResponse(**result)
    except RuntimeError as exc:
        # Errores de configuracion conocidos (p. ej. falta GROQ_API_KEY): el
        # mensaje esta escrito por nosotros y es seguro mostrarlo.
        logger.error("Error de configuracion en /api/chat: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception:
        # El detalle tecnico queda en el log del servidor, no se filtra al cliente.
        logger.exception("Error inesperado en /api/chat")
        raise HTTPException(
            status_code=500,
            detail="Ocurrio un error al procesar tu pregunta. Intentalo de nuevo en un momento.",
        )


@app.post("/api/tts")
async def synthesize_speech(req: TTSRequest):
    """Genera audio con voz neuronal humana, calida y amigable en espanol
    ecuatoriano (es-EC-LuisNeural) para Utemito."""
    raw = (req.text or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Texto vacio")

    clean = re.sub(r"https?://\S+", " el enlace del panel izquierdo ", raw, flags=re.IGNORECASE)
    clean = re.sub(r"\bwww\.\S+", " el enlace del panel izquierdo ", clean, flags=re.IGNORECASE)
    clean = re.sub(
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
        " el correo del panel izquierdo ",
        clean,
    )
    clean = re.sub(r"[*_#`>~]", "", clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    if not clean:
        raise HTTPException(status_code=400, detail="Texto sin contenido pronunciable")

    cache_key = hashlib.sha256(f"{TTS_VOICE}|{TTS_RATE}|{TTS_PITCH}|{clean}".encode("utf-8")).hexdigest()
    if cache_key in _TTS_CACHE:
        return Response(content=_TTS_CACHE[cache_key], media_type="audio/mpeg")

    try:
        communicate = edge_tts.Communicate(
            clean,
            voice=TTS_VOICE,
            rate=TTS_RATE,
            pitch=TTS_PITCH,
        )
        chunks: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio" and chunk.get("data"):
                chunks.append(chunk["data"])
        audio_bytes = b"".join(chunks)
        if not audio_bytes:
            raise RuntimeError("No se recibio audio del sintetizador neuronal")
        if len(_TTS_CACHE) > 80:
            _TTS_CACHE.clear()
        _TTS_CACHE[cache_key] = audio_bytes
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as exc:
        logger.warning("Fallo TTS neuronal, el cliente usara sintesis local: %s", exc)
        raise HTTPException(status_code=502, detail="TTS neuronal no disponible temporalmente")


@app.get("/api/health")
def health():
    return {"status": "ok"}
