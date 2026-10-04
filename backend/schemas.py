from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatTurn] = Field(default_factory=list)


class ChatResponse(BaseModel):
    respuesta: str
    fuentes: list[str] = Field(default_factory=list)


# ---------- Panel de administracion ----------

class DocumentoInfo(BaseModel):
    nombre: str
    tamano_kb: float
    fragmentos: int
    indexado: bool
    archivo_presente: bool = True


class DocumentosResponse(BaseModel):
    documentos: list[DocumentoInfo] = Field(default_factory=list)
    total_documentos: int = 0
    total_fragmentos: int = 0


class ArchivoResultado(BaseModel):
    nombre: str
    estado: str  # "ok" | "error"
    fragmentos: int = 0
    detalle: str = ""


class OperacionResponse(BaseModel):
    archivos: list[ArchivoResultado] = Field(default_factory=list)
    total_fragmentos: int = 0


class ContactoInfo(BaseModel):
    documento: str
    tipo: str  # "correo" | "telefono" | "enlace"
    valor: str
    seccion: str = ""


class ContactosResponse(BaseModel):
    contactos: list[ContactoInfo] = Field(default_factory=list)
    total: int = 0
