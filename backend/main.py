"""
Punto de entrada de la aplicacion. Levanta la API (FastAPI) y sirve el
frontend (HTML/CSS/JS) donde el estudiante conversa con "Utemito", el buho.

Ejecutar con:
    uvicorn backend.main:app --reload
"""
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend import config
from backend.admin import router as admin_router
from backend.rag.llm import ask_buho
from backend.schemas import ChatRequest, ChatResponse
from backend.security import LimitadorTasa

logger = logging.getLogger("utemito")

limitador_chat = LimitadorTasa(limite=config.RATE_LIMIT_PER_MIN, ventana=60.0)

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="Utemito - Asistente Virtual FCI-UTM")

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
    if request.url.path.startswith(("/animaciones/", "/assets/")):
        response.headers["Cache-Control"] = "public, max-age=604800"
    else:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response

app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")
app.mount("/animaciones", StaticFiles(directory=FRONTEND_DIR / "animaciones"), name="animaciones")


app.include_router(admin_router)


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/admin")
def admin_panel():
    return FileResponse(FRONTEND_DIR / "admin.html")


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest, request: Request):
    cliente = request.client.host if request.client else "desconocido"
    if not limitador_chat.permitir(cliente):
        raise HTTPException(
            status_code=429,
            detail="Estas enviando muchas preguntas seguidas. Espera un momento e intentalo de nuevo.",
        )
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


@app.get("/api/health")
def health():
    return {"status": "ok"}
