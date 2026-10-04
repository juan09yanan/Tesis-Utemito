"""
Panel de administracion: endpoints para subir, listar, borrar y reindexar los
documentos que forman la base de conocimiento del buho (carpeta `documentos/` +
base vectorial ChromaDB).

Todas las rutas cuelgan de /api/admin y, si se define la variable de entorno
ADMIN_TOKEN, exigen la cabecera  X-Admin-Token  con ese valor.
"""
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile

from backend import config, db
from backend.rag.ingest import (
    SUPPORTED_EXTENSIONS,
    index_document,
    indexed_sources,
    reindex_all,
    remove_document,
)
from backend.schemas import (
    ArchivoResultado,
    ContactoInfo,
    ContactosResponse,
    DocumentoInfo,
    DocumentosResponse,
    OperacionResponse,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])

DOCS_DIR = Path(config.DOCUMENTOS_PATH)
MAX_UPLOAD_BYTES = config.MAX_UPLOAD_MB * 1024 * 1024


def verificar_token(x_admin_token: str | None = Header(default=None)):
    """Dependencia: valida el token de administrador si esta configurado."""
    if config.ADMIN_TOKEN and x_admin_token != config.ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Token de administrador invalido o ausente.")


def _nombre_seguro(filename: str | None) -> str:
    """Se queda solo con el nombre del archivo (sin rutas) y valida la extension."""
    if not filename:
        raise HTTPException(status_code=400, detail="Archivo sin nombre.")
    nombre = Path(filename).name
    if Path(nombre).suffix.lower() not in SUPPORTED_EXTENSIONS:
        aceptados = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"Formato no soportado: '{nombre}'. Formatos aceptados: {aceptados}.",
        )
    return nombre


def _listar_documentos() -> DocumentosResponse:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    indexados = indexed_sources()

    docs: list[DocumentoInfo] = []
    en_disco: set[str] = set()
    for f in sorted(DOCS_DIR.glob("*")):
        if not f.is_file() or f.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        en_disco.add(f.name)
        docs.append(
            DocumentoInfo(
                nombre=f.name,
                tamano_kb=round(f.stat().st_size / 1024, 1),
                fragmentos=indexados.get(f.name, 0),
                indexado=f.name in indexados,
                archivo_presente=True,
            )
        )

    # Documentos que estan indexados en la base pero cuyo archivo ya no existe.
    for nombre in sorted(set(indexados) - en_disco):
        docs.append(
            DocumentoInfo(
                nombre=nombre,
                tamano_kb=0.0,
                fragmentos=indexados[nombre],
                indexado=True,
                archivo_presente=False,
            )
        )

    return DocumentosResponse(
        documentos=docs,
        total_documentos=len(docs),
        total_fragmentos=sum(d.fragmentos for d in docs),
    )


@router.get("/documents", response_model=DocumentosResponse)
def listar_documentos(_: None = Depends(verificar_token)):
    return _listar_documentos()


@router.post("/upload", response_model=OperacionResponse)
async def subir_documentos(
    files: list[UploadFile] = File(...),
    _: None = Depends(verificar_token),
):
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    resultados: list[ArchivoResultado] = []

    for archivo in files:
        try:
            nombre = _nombre_seguro(archivo.filename)
        except HTTPException as exc:
            resultados.append(
                ArchivoResultado(
                    nombre=archivo.filename or "(sin nombre)",
                    estado="error",
                    detalle=exc.detail,
                )
            )
            continue

        contenido = await archivo.read()
        if len(contenido) == 0:
            resultados.append(
                ArchivoResultado(nombre=nombre, estado="error", detalle="El archivo esta vacio.")
            )
            continue
        if len(contenido) > MAX_UPLOAD_BYTES:
            resultados.append(
                ArchivoResultado(
                    nombre=nombre,
                    estado="error",
                    detalle=f"Supera el limite de {config.MAX_UPLOAD_MB} MB.",
                )
            )
            continue

        destino = DOCS_DIR / nombre
        try:
            destino.write_bytes(contenido)
            n = index_document(destino)
            resultados.append(
                ArchivoResultado(
                    nombre=nombre,
                    estado="ok",
                    fragmentos=n,
                    detalle="Indexado correctamente." if n else "Guardado, pero sin texto para indexar.",
                )
            )
        except Exception as exc:  # noqa: BLE001
            # Si fallo la indexacion no dejamos el archivo suelto sin indexar.
            if destino.exists():
                destino.unlink(missing_ok=True)
            resultados.append(
                ArchivoResultado(nombre=nombre, estado="error", detalle=f"Error al procesar: {exc}")
            )

    total = _listar_documentos().total_fragmentos
    return OperacionResponse(archivos=resultados, total_fragmentos=total)


@router.delete("/documents/{nombre}", response_model=OperacionResponse)
def borrar_documento(nombre: str, _: None = Depends(verificar_token)):
    nombre = Path(nombre).name
    archivo = DOCS_DIR / nombre
    existia_archivo = archivo.is_file()
    estaba_indexado = nombre in indexed_sources()

    if not existia_archivo and not estaba_indexado:
        raise HTTPException(status_code=404, detail=f"No existe el documento '{nombre}'.")

    if existia_archivo:
        archivo.unlink()
    remove_document(nombre)

    resumen = _listar_documentos()
    return OperacionResponse(
        archivos=[ArchivoResultado(nombre=nombre, estado="ok", detalle="Documento eliminado.")],
        total_fragmentos=resumen.total_fragmentos,
    )


@router.post("/reindex", response_model=OperacionResponse)
def reindexar(_: None = Depends(verificar_token)):
    resultado = reindex_all()
    archivos = [
        ArchivoResultado(
            nombre=nombre,
            estado="error" if n < 0 else "ok",
            fragmentos=max(n, 0),
            detalle="Error al indexar." if n < 0 else f"{n} fragmento(s).",
        )
        for nombre, n in sorted(resultado.items())
    ]
    total = sum(a.fragmentos for a in archivos)
    return OperacionResponse(archivos=archivos, total_fragmentos=total)


@router.get("/contacts", response_model=ContactosResponse)
def listar_contactos_extraidos(_: None = Depends(verificar_token)):
    """Contactos (correos, telefonos, enlaces) extraidos de los documentos y
    guardados en la base de datos SQLite. Sirve para verificar que la
    extraccion funciono bien antes de que el buho los use al responder."""
    filas = db.listar_contactos()
    contactos = [ContactoInfo(**f) for f in filas]
    return ContactosResponse(contactos=contactos, total=len(contactos))
