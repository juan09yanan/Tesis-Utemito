# Utemito 🦉 — Asistente Virtual de la Facultad de Ciencias Informáticas (UTM)

Sistema web que permite a los estudiantes de la Facultad de Ciencias Informáticas
de la Universidad Técnica de Manabí (UTM) hacer preguntas sobre trámites
universitarios (matrícula, certificados, becas, prácticas preprofesionales,
titulación, homologaciones, etc.) a **Utemito**, un búho asistente virtual
impulsado por Inteligencia Artificial.

El sistema usa una arquitectura **RAG (Retrieval Augmented Generation)**:
en lugar de que la IA "invente" respuestas, primero busca la información
relevante dentro de los documentos oficiales de la facultad (que tú le
proporcionas) y luego genera una respuesta clara basada en esa información.

---

## 1. Arquitectura

```
Estudiante (navegador)
        │
        ▼
  Frontend (HTML/CSS/JS)  →  avatar del búho + chat
        │  fetch /api/chat
        ▼
  Backend FastAPI (Python)
        │
        ├─► ChromaDB (base vectorial local)  ← documentos/*.md/.pdf/.docx
        │        (busca los fragmentos más relevantes a la pregunta)
        │
        └─► Groq API (LLM gratuito, GPT-OSS-120B)
                 (genera la respuesta final usando el contexto recuperado)
```

**Todas las herramientas usadas son 100% gratuitas:**

| Componente          | Herramienta                                   | Costo |
|---------------------|------------------------------------------------|-------|
| Backend / API       | FastAPI + Uvicorn                              | Gratis |
| Modelo de lenguaje  | [Groq API](https://console.groq.com) (GPT-OSS-120B) | Gratis (tier gratuito) |
| Embeddings          | sentence-transformers (multilingüe, corre local) | Gratis |
| Base vectorial      | ChromaDB (local, se guarda en tu PC)           | Gratis |
| Frontend            | HTML/CSS/JS puro                               | Gratis |
| Hosting (opcional)  | Render / HuggingFace Spaces (free tier)        | Gratis |

---

## 2. Estructura del proyecto

```
PROYECTO TESIS/
├── backend/
│   ├── main.py            # API FastAPI (sirve frontend + endpoints /api/chat y /admin)
│   ├── config.py          # Configuración (lee variables de entorno)
│   ├── schemas.py         # Modelos de datos (Pydantic)
│   ├── admin.py           # Endpoints del panel de administración (/api/admin/*)
│   └── rag/
│       ├── store.py       # Cliente ChromaDB (base vectorial)
│       ├── ingest.py      # Indexado de documentos (CLI + funciones para el panel)
│       └── llm.py         # Lógica de recuperación + llamada a Groq
├── documentos/             # ← AQUÍ van los documentos reales de la facultad
│                           #   (vacía; súbelos desde /admin o cópialos aquí)
├── frontend/
│   ├── index.html          # Interfaz del chat
│   ├── css/style.css       # Estilos + animaciones del búho
│   ├── js/chat.js          # Lógica del chat (fetch al backend)
│   ├── admin.html          # Panel web para subir/borrar/reindexar documentos
│   ├── css/admin.css       # Estilos del panel de administración
│   ├── js/admin.js         # Lógica del panel de administración
│   └── assets/buho.svg     # Avatar del búho (SVG editable)
├── chroma_db/               # Se genera automáticamente (base vectorial)
├── requirements.txt
├── .env.example
└── README.md
```

> ℹ️ La carpeta `documentos/` está **vacía**. El búho responde exclusivamente
> con lo que tú subas: matrícula, certificados, becas, prácticas, titulación,
> homologación, contactos, etc. Toda la información (incluidos correos, teléfonos
> y enlaces) debe estar dentro de esos documentos. Súbelos desde el panel
> **/admin** o cópialos a `documentos/` y corre `python -m backend.rag.ingest`.

---

## 3. Instalación paso a paso

### Requisitos previos
- Python 3.10 o superior instalado.
- Una cuenta gratuita en [Groq Console](https://console.groq.com) para obtener tu API Key (no requiere tarjeta de crédito).

### Paso 1 — Crear entorno virtual e instalar dependencias

En PowerShell, dentro de la carpeta del proyecto. Si descargaste el proyecto con
una carpeta `venv/` ya incluida, **bórrala primero** (está ligada a la máquina
donde se creó y no funcionará en la tuya):

```powershell
Remove-Item -Recurse -Force venv   # solo si vino una venv en la descarga
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

> La primera vez, `pip` descarga PyTorch y el modelo de embeddings (~1 GB en
> total); puede tardar varios minutos. También la primera petición al servidor
> carga el modelo de embeddings en memoria y tarda un poco; las siguientes son rápidas.

### Paso 2 — Configurar tu API Key gratuita de Groq

1. Entra a https://console.groq.com y crea una cuenta gratuita.
2. Ve a **API Keys → Create API Key** y copia la clave generada.
3. Copia el archivo de ejemplo y pega tu clave:

```powershell
copy .env.example .env
```

4. Abre `.env` y coloca tu clave en `GROQ_API_KEY=...`

### Paso 3 — Cargar los documentos (crear la base de conocimiento)

Dos opciones (ver también la sección 4):

- **Desde el navegador (recomendado):** levanta el servidor (Paso 4) y abre
  **http://localhost:8000/admin**. Arrastra ahí tus documentos (`.md`, `.txt`,
  `.pdf`, `.docx`); se guardan e indexan automáticamente.
- **Desde la terminal:** copia tus documentos a `documentos/` y ejecuta
  `python -m backend.rag.ingest` (reindexa todo desde cero).

La base vectorial se crea en `chroma_db/`. El búho solo sabe lo que esté en
esos documentos.

### Paso 4 — Levantar el servidor

```powershell
uvicorn backend.main:app --reload
```

Abre tu navegador en **http://localhost:8000** y ¡ya puedes conversar con Utemito! 🦉

---

## 4. Cómo actualizar la información del búho

Hay dos formas equivalentes:

### Opción A — Panel de administración web (recomendado)

Abre **http://localhost:8000/admin** (o el enlace "Administración" en el pie del
chat). Desde ahí puedes, sin usar la terminal:

- **Subir documentos** (`.md`, `.txt`, `.pdf`, `.docx`) arrastrándolos o
  eligiéndolos: se guardan en `documentos/` y se indexan al instante.
- **Ver la lista** de documentos con su tamaño y número de fragmentos indexados.
- **Eliminar** un documento (borra el archivo y sus fragmentos de la base vectorial).
- **Reindexar todo** desde cero.

Para proteger el panel, define `ADMIN_TOKEN` en tu `.env`; entonces pedirá ese
token al entrar. Si lo dejas vacío, el panel queda abierto (cómodo en local).

### Opción B — Terminal

1. Agrega/edita/borra archivos dentro de `documentos/` (soporta `.md`, `.txt`, `.pdf`, `.docx`).
2. Vuelve a correr `python -m backend.rag.ingest` (reindexa todo desde cero).
3. Reinicia el servidor si hace falta.

No necesitas "reentrenar" ningún modelo: el LLM (Groq) ya viene entrenado
en lenguaje general; lo que cambia es la información que le damos como
contexto (RAG), por eso este enfoque es rápido, gratuito y fácil de
mantener para una tesis.

### Cómo responde el búho (grounding estricto)

- El búho responde **únicamente con la información de los documentos** que subas.
  Si algo no está en ellos, lo dice ("No tengo esa información exacta en mis
  documentos") y deriva al estudiante a la dependencia correspondiente.
- Al indexar, el texto se trocea **respetando su estructura** (encabezados y
  párrafos) y **nunca se parte por la mitad un bloque con datos de contacto**,
  para que un correo o un teléfono no quede cortado entre dos fragmentos.
- Antes de responder, el sistema **detecta los correos, teléfonos/extensiones y
  enlaces que ya están escritos en tus documentos** y se los resalta al modelo
  para que los reproduzca **tal cual**. No añade ningún dato que no esté en el
  documento. En el chat se muestran como enlaces clicables (`mailto:` y `http`).
- Opcional: con `ALWAYS_INCLUDE_SOURCES` en el `.env` puedes indicar el nombre de
  un documento tuyo (p. ej. uno de contactos) para que se incluya siempre en el
  contexto. Por defecto está vacío.

---

## 5. Personalizar el avatar del búho

El avatar es un SVG editable en `frontend/assets/buho.svg` (y una copia
inline en `frontend/index.html` para poder animarlo con CSS/JS). Puedes:
- Cambiar los colores en `frontend/css/style.css` (variables `--verde-utm`, `--dorado`, etc.). Ya están configurados con el verde institucional oficial (`#00983d`, tomado del sitio web utm.edu.ec) combinado con un dorado de acento.
- Reemplazar el SVG por un diseño propio o por una ilustración/logo oficial del búho de la UTM, si la universidad ya tiene uno.

Animaciones incluidas: parpadeo automático, flotación suave (idle),
"pensando" (mientras espera la respuesta), "hablando" (mientras muestra o
lee en voz alta la respuesta) y "escuchando" (brillo pulsante mientras
espera que hables, en el modo de conversación por voz).

---

## 6. Funciones de voz (hablar con Utemito)

El sistema incluye dos funciones de voz, implementadas con la **Web Speech
API** del navegador (nativa, 100% gratuita, sin backend ni API keys
adicionales):

1. **Preguntar por voz (🎤 junto al campo de texto):** dicta tu pregunta,
   se transcribe automáticamente a texto en el campo de chat y se envía
   como una pregunta normal (respuesta en texto).
2. **"Hablar con Utemito" (botón en el panel del avatar):** activa un
   diálogo continuo por voz — hablas, Utemito transcribe tu pregunta,
   responde y **lee la respuesta en voz alta**; al terminar de hablar,
   vuelve a escuchar automáticamente para que puedas seguir conversando
   sin tocar el teclado. Pulsa el mismo botón para detener la conversación.

**Compatibilidad:** funciona de forma confiable en **Google Chrome y
Microsoft Edge**. Firefox y Safari tienen soporte limitado o nulo de
`SpeechRecognition`; en esos navegadores los botones de voz se deshabilitan
automáticamente y el chat por texto sigue funcionando con normalidad.

**Nota sobre Brave, Opera y otros navegadores basados en Chromium:** aunque
técnicamente "soportan" la API, el reconocimiento de voz gratuito de Google
requiere una clave interna que **solo viene incluida en Chrome y Edge
oficiales**. Brave la omite a propósito por privacidad (no envía audio a
los servidores de Google), así que el reconocimiento siempre falla con un
error de "network" en Brave, sin importar tu conexión a internet. La app
detecta Brave automáticamente y deshabilita los botones de voz con un
mensaje explicativo en vez de fallar de forma confusa. Si necesitas la
función de voz, usa Chrome o Edge.

**Requisito de contexto seguro:** el micrófono solo funciona en `localhost`
o en un sitio servido por **HTTPS**. Si despliegas el sistema (ver sección
7), verifica que el hosting elegido sirva la app con HTTPS (Render,
HuggingFace Spaces y Railway lo hacen por defecto).

---

## 7. Despliegue gratuito (para la defensa de tesis)

Opciones sin costo para publicar el sistema en internet:
- **Render.com** (free tier): sube el repo, define `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` como start command.
- **HuggingFace Spaces** (SDK: Docker): ideal si quieres mostrarlo públicamente.
- **Railway.app** (free trial/tier limitado).

En todos los casos, recuerda configurar la variable de entorno `GROQ_API_KEY`
en el panel del servicio (no subas tu `.env` real a ningún repositorio público).

---

## 8. Posibles mejoras futuras (para la sección de "trabajo futuro" de la tesis)

- ~~Panel de administración web para subir documentos sin usar la terminal.~~ ✅ Implementado (`/admin`).
- Autenticación de estudiantes (login institucional).
- Historial de conversaciones guardado en base de datos (PostgreSQL/SQLite).
- Voces más naturales con un servicio TTS neuronal (ej. ElevenLabs, ver límites gratuitos) en vez de las voces del sistema operativo.
- Métricas de las preguntas más frecuentes para mejorar la base de conocimiento.
- Soporte multi-idioma (inglés) para estudiantes de intercambio.

---

## 9. Solución de problemas comunes

| Problema | Solución |
|----------|----------|
| `Falta configurar GROQ_API_KEY` | Revisa que exista el archivo `.env` con tu clave válida. |
| El búho responde "no tengo esa información" | Corre `python -m backend.rag.ingest` para indexar tus documentos. |
| Error al instalar `sentence-transformers` | Asegúrate de tener Python 3.10+ y `pip` actualizado (`python -m pip install --upgrade pip`). |
| El puerto 8000 ya está en uso | Usa otro puerto: `uvicorn backend.main:app --reload --port 8080`. |
| Error `model_not_found` / `does not exist` de Groq | Groq actualiza periódicamente su catálogo de modelos gratuitos. Revisa los modelos vigentes en https://console.groq.com/docs/models y actualiza `GROQ_MODEL` en tu `.env`. |
| Los botones de voz aparecen deshabilitados | Usa Chrome o Edge (Firefox/Safari no soportan bien la Web Speech API; en Brave se deshabilitan automáticamente porque esa función no funciona ahí). |
| El micrófono no funciona en el sitio desplegado | El navegador exige HTTPS (o `localhost`) para acceder al micrófono; confirma que tu hosting sirva la app por HTTPS. |
| Error "Sin conexión al servicio de reconocimiento de voz de Google" (`network`) | Casi siempre significa que usas un navegador que no es Chrome/Edge (ej. Brave, Opera). Prueba con Google Chrome o Microsoft Edge. |

---

## Calidad y evaluación del RAG

- **Umbral de distancia (`MAX_DISTANCE`)**: se descartan los fragmentos poco
  parecidos a la pregunta, de modo que una pregunta fuera de tema ya no recibe
  contexto irrelevante.
- **Reescritura con historial (`REWRITE_QUERY`)**: las preguntas de seguimiento
  se convierten en consultas autónomas antes de buscar.
- **Set de evaluación** (`evaluacion/`): mide la recuperación sin llamar al LLM
  de respuesta. Úsalo antes y después de cada cambio al RAG:

  ```bash
  python -m evaluacion.run_eval -v          # resultado por pregunta
  python -m evaluacion.run_eval --sweep     # barrido de umbrales
  ```

  Agrega tus propias preguntas a `evaluacion/preguntas.json` (campo `claves`:
  texto que debe aparecer en el contexto recuperado).
- **Tests**: `pip install -r requirements-dev.txt` y `pytest`.

> **Importante (seguridad):** el panel `/admin` exige `ADMIN_TOKEN` en `.env`.
> Sin token, la API de administración se rechaza. Solo para desarrollo local
> puedes usar `ALLOW_INSECURE_ADMIN=true`.
