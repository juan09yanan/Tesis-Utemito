"""
Seguridad y privacidad del chat de Utemito.

Capas (de la entrada a la salida):
  1. evaluar_pregunta(): bloquea ANTES de llamar al modelo las preguntas que piden
     datos personales de terceros, listados de estudiantes, claves/secretos del
     sistema o que intentan manipular las instrucciones del asistente. El modelo
     ni siquiera ve esas consultas.
  2. redactar_pii(): oculta cedulas validas (y datos personales parecidos) en los
     fragmentos recuperados y en el historial antes de enviarlos al modelo.
  3. sanitizar_respuesta(): ultima barrera sobre lo que el modelo contesta:
     correos inventados o personales, cedulas, fugas del prompt interno y
     referencias a "tus documentos subidos".
  4. LimitadorTasa: limite de consultas por IP contra abuso/automatizacion.

El texto de las consultas NO se registra en logs, solo la categoria del bloqueo.
"""
from __future__ import annotations

import re
import time
import unicodedata
from collections import defaultdict, deque
from dataclasses import dataclass

# ---------------------------------------------------------------- utilidades

def normalizar(texto: str) -> str:
    """Minusculas, sin tildes ni signos, espacios colapsados (para comparar)."""
    t = unicodedata.normalize("NFKD", (texto or "").lower())
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = re.sub(r"[^a-z0-9@.\s]", " ", t)
    t = t.replace(".", " ")
    return re.sub(r"\s+", " ", t).strip()


def cedula_valida(num: str) -> bool:
    """Valida una cedula ecuatoriana de 10 digitos (algoritmo modulo 10)."""
    if not re.fullmatch(r"\d{10}", num or ""):
        return False
    provincia = int(num[:2])
    if not (1 <= provincia <= 24 or provincia in (30,)):
        return False
    if int(num[2]) > 5:
        return False
    total = 0
    for i, ch in enumerate(num[:9]):
        d = int(ch) * (2 if i % 2 == 0 else 1)
        total += d - 9 if d > 9 else d
    return (10 - total % 10) % 10 == int(num[9])


# ------------------------------------------------------------------ entrada

MSG_TERCEROS = (
    "Por privacidad no puedo buscar ni compartir datos personales o academicos de "
    "estudiantes ni de otras personas (cedulas, telefonos, correos personales, "
    "direcciones, notas, listados, etc.). Esa informacion esta protegida por la Ley "
    "Organica de Proteccion de Datos Personales y solo puede solicitarla su titular "
    "directamente en la Secretaria Academica de la FCI. ¿Te ayudo con algun tramite?"
)
MSG_PROPIOS = (
    "No tengo acceso a informacion personal ni academica de ningun estudiante, asi "
    "que no puedo mostrarte tus notas ni tus datos. Puedes consultarlos con tu "
    "usuario en el sistema academico de la UTM o en la Secretaria Academica de la FCI. "
    "Si quieres, te explico como se solicita ese tramite."
)
MSG_SECRETOS = (
    "No puedo compartir claves, tokens ni informacion interna del sistema. "
    "¿En que tramite de la FCI-UTM te puedo orientar?"
)
MSG_MANIPULACION = (
    "No puedo cambiar mis reglas ni revelar mi configuracion interna. Estoy aqui "
    "para orientarte sobre tramites de la FCI-UTM: matricula, becas, practicas, "
    "titulacion y mas. ¿Que necesitas?"
)
MSG_DATO_EN_CHAT = (
    "Por tu seguridad, no escribas tu cedula, numeros de tarjeta u otros datos "
    "sensibles en este chat: no los necesito para orientarte. Cuentame tu duda "
    "sin esos datos y con gusto te ayudo."
)

_DATOS_FUERTES = (
    r"cedula|identificacion|pasaporte|telefono|celular|whatsapp|correo personal|"
    r"email personal|direccion|domicilio|donde vive|fecha de nacimiento|"
    r"notas?|calificacion(?:es)?|promedio|record academico|historial academico|"
    r"expediente|sanci(?:on|ones)|discapacidad|salud|enfermedad|datos personales|"
    r"informacion personal|situacion economica|ingresos|numero de matricula"
)
_RE_DATO = re.compile(rf"\b(?:{_DATOS_FUERTES})\b")

# Palabras que indican una pregunta de procedimiento ("como solicito...").
_RE_PROCEDIMIENTO = re.compile(
    r"\b(como|donde|cuando|que requisitos|requisitos|tramite|proceso|procedimiento|"
    r"solicit\w*|pasos|puedo|se puede|necesito para|obtener|sacar|descargar|"
    r"cuanto cuesta|costo|plazo|fecha limite)\b"
)

# Despues de "de/del" estas palabras indican un dato institucional, no personal.
_INSTITUCIONAL = {
    "utm", "fci", "facultad", "universidad", "secretaria",
    "decanato", "decano", "decana", "carrera", "bienestar", "oficina", "departamento",
    "coordinacion", "coordinador", "coordinadora", "biblioteca", "institucion",
    "admision", "titulacion", "matricula", "practicas", "tramite", "materia",
    "asignatura", "examen", "curso", "semestre", "ciclo", "nivel", "periodo",
    "corte", "consejo", "comision", "area", "unidad", "direccion", "subdecano",
}
_ARTICULOS = {"la", "el", "los", "las", "un", "una", "mi", "tu", "su"}
_RE_DATO_DE = re.compile(rf"\b(?:{_DATOS_FUERTES})\s+(?:de|del)\s+(\w+)(?:\s+(\w+))?")

_RE_PROPIOS = re.compile(
    rf"\b(?:mi|mis)\s+(?:{_DATOS_FUERTES})\b|\b(?:cual es|dame|dime|muestrame|"
    r"consulta|revisa|ver|que)\s+(?:mi|mis)\s+\w+"
)

_RE_LISTADOS = re.compile(
    r"\b(?:lista|listado|nomina|quienes|que estudiantes|cuales estudiantes)"
    r"\b.{0,40}\b(?:estudiantes|alumnos|matriculados|aprobados|reprobados|becados|"
    r"egresados|graduados|admitidos|inscritos|postulantes)\b"
)

_RE_SECRETOS = re.compile(
    r"\b(?:contrasena|password|clave|token|api ?key|apikey|credenciales|secreto|"
    r"admin ?token|env)\b.{0,40}\b(?:admin\w*|sistema|servidor|base de datos|groq|"
    r"utemito|panel|backend|chroma|sqlite)\b|"
    r"\b(?:admin\w*|sistema|servidor|groq|utemito|panel|backend)\b.{0,40}"
    r"\b(?:contrasena|password|clave|token|api ?key|apikey|credenciales|admin ?token)\b"
)

_RE_MANIPULACION = re.compile(
    r"ignora\w*\s+(?:todas\s+)?(?:las\s+|tus\s+|mis\s+)?(?:instrucciones|reglas|indicaciones|restricciones)|"
    r"olvida\w*\s+(?:todo|tus|las|todas)|"
    r"(?:muestra|dime|revela|repite|imprime|escribe|cual es)\w*\s+(?:tu|el|tus)\s+(?:system\s+)?(?:prompt|instrucciones)|"
    r"prompt\s+del\s+sistema|system\s*prompt|instrucciones\s+(?:internas|del sistema|iniciales|ocultas)|"
    r"modo\s+(?:desarrollador|dios|debug|admin\w*|sin restricciones)|developer\s+mode|jailbreak|"
    r"do anything now|sin\s+(?:restricciones|filtros|reglas|limites)|"
    r"(?:finge|actua|haz de cuenta|imagina)\w*\s+que\s+(?:no tienes|eres otro|eres un)|"
    r"pretend|ignore (?:all|previous|your)"
)

_RE_DIGITOS_LARGOS = re.compile(r"\b\d{13,19}\b")
_RE_DIEZ_DIGITOS = re.compile(r"\b\d{10}\b")


@dataclass(frozen=True)
class Veredicto:
    categoria: str
    mensaje: str


def evaluar_pregunta(pregunta: str) -> Veredicto | None:
    """Devuelve un Veredicto si la pregunta debe bloquearse, o None si es segura."""
    original = pregunta or ""
    n = normalizar(original)

    # Intento de manipular al asistente / sacar el prompt o secretos.
    if _RE_MANIPULACION.search(n):
        return Veredicto("manipulacion", MSG_MANIPULACION)
    if _RE_SECRETOS.search(n):
        return Veredicto("secretos", MSG_SECRETOS)

    # El usuario escribio datos sensibles propios (cedula valida, tarjeta).
    if _RE_DIGITOS_LARGOS.search(original) or any(
        cedula_valida(m) for m in _RE_DIEZ_DIGITOS.findall(original)
    ):
        return Veredicto("dato_en_chat", MSG_DATO_EN_CHAT)

    procedimiento = bool(_RE_PROCEDIMIENTO.search(n))

    # Listados masivos de personas.
    if _RE_LISTADOS.search(n):
        return Veredicto("listado", MSG_TERCEROS)

    # Datos de otra persona: "cedula de Juan Perez", "notas del estudiante X".
    if not procedimiento:
        for m in _RE_DATO_DE.finditer(n):
            palabra = m.group(1)
            if palabra in _ARTICULOS and m.group(2):
                palabra = m.group(2)
            if palabra not in _INSTITUCIONAL:
                return Veredicto("datos_terceros", MSG_TERCEROS)

    # Datos propios: el asistente no tiene acceso a registros individuales.
    if not procedimiento and _RE_PROPIOS.search(n) and _RE_DATO.search(n):
        return Veredicto("datos_propios", MSG_PROPIOS)

    return None


# ------------------------------------------------------------------- salida

_PERSONAL_DOMINIOS = (
    "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.es", "live.com",
    "icloud.com", "protonmail.com", "gmail.es", "hotmail.es",
)
_RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_RE_FUGA_PROMPT = re.compile(
    r"reglas que debes seguir|eres\s+\"?utemito\"?\s*,\s*el buho mascota|"
    r"contexto recuperado|basate exclusivamente en el contexto",
    re.IGNORECASE,
)
_RE_TUS_DOCUMENTOS = re.compile(
    r"(?:seg[uú]n|de acuerdo (?:con|a)|con base en|en|a partir de|revisando)\s+"
    r"(?:tus|mis|los|las|el|la)\s+(?:documentos?|archivos?|pdfs?|base de datos|base de conocimiento)"
    r"(?:\s+(?:que\s+)?(?:subidos?|cargados?|subiste|cargaste|me diste|tengo|disponibles?))*",
    re.IGNORECASE,
)
_RE_DOCS_RESTO = re.compile(
    r"\b(?:tus|mis)\s+(?:documentos?|archivos?)(?:\s+(?:subidos?|cargados?))?", re.IGNORECASE
)
FRASE_INSTITUCIONAL = "según la información oficial de la facultad"


def redactar_pii(texto: str, permitidos: set[str] | None = None) -> str:
    """Oculta cedulas validas que no sean datos de contacto oficiales."""
    permitidos = permitidos or set()

    def _sub(m: re.Match) -> str:
        num = m.group(0)
        if num in permitidos or not cedula_valida(num):
            return num
        return "[dato personal oculto]"

    return _RE_DIEZ_DIGITOS.sub(_sub, texto or "")


def sanitizar_respuesta(
    respuesta: str, contexto: str = "", permitidos: set[str] | None = None
) -> str:
    """Ultima barrera sobre la respuesta del modelo."""
    permitidos = permitidos or set()
    texto = respuesta or ""
    contexto_l = (contexto or "").lower()
    permitidos_l = {p.lower() for p in permitidos}

    if _RE_FUGA_PROMPT.search(texto):
        return MSG_MANIPULACION

    def _correo(m: re.Match) -> str:
        c = m.group(0).lower().rstrip(".")
        dominio = c.split("@", 1)[1]
        if c not in contexto_l:
            return "[correo no disponible]"  # inventado: no esta en el contexto
        if dominio in _PERSONAL_DOMINIOS and c not in permitidos_l:
            return "[correo personal oculto]"
        return m.group(0)

    texto = _RE_EMAIL.sub(_correo, texto)
    texto = redactar_pii(texto, permitidos)
    texto = _RE_TUS_DOCUMENTOS.sub(FRASE_INSTITUCIONAL, texto)
    texto = _RE_DOCS_RESTO.sub("la información oficial de la facultad", texto)
    return texto


# ------------------------------------------------------------ limite de tasa

class LimitadorTasa:
    """Ventana deslizante en memoria: maximo `limite` consultas por `ventana` s
    y por cliente. Suficiente para un solo proceso (prototipo)."""

    def __init__(self, limite: int = 20, ventana: float = 60.0, max_clientes: int = 5000):
        self.limite = limite
        self.ventana = ventana
        self.max_clientes = max_clientes
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def permitir(self, cliente: str, ahora: float | None = None) -> bool:
        if self.limite <= 0:
            return True
        ahora = time.monotonic() if ahora is None else ahora
        if len(self._hits) > self.max_clientes:
            self._hits = defaultdict(
                deque, {k: v for k, v in self._hits.items() if v and ahora - v[-1] < self.ventana}
            )
        q = self._hits[cliente]
        while q and ahora - q[0] >= self.ventana:
            q.popleft()
        if len(q) >= self.limite:
            return False
        q.append(ahora)
        return True
