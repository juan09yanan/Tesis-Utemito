const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('chatForm');
const inputEl = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const voiceModeBtn = document.getElementById('voiceModeBtn');
const avatarWrap = document.getElementById('avatarWrap');
const avatarCaption = document.getElementById('avatarCaption');
const buhoVideo = document.getElementById('buhoVideo');

// Panel izquierdo: Enlaces, correos y telefonos
const recursosPanel = document.getElementById('recursosPanel');
const recursosList = document.getElementById('recursosList');
const recursosEmpty = document.getElementById('recursosEmpty');
const recursosCount = document.getElementById('recursosCount');
const clearRecursosBtn = document.getElementById('clearRecursosBtn');
const recursosFilters = document.getElementById('recursosFilters');

const DEFAULT_CAPTION = '';

let history = [];
let hablarTimeoutId = null;

// ============ Motor de Animacion del Avatar 3D (Saludo -> Espera -> Hablar) ============
// Controla los 3 flujos del avatar 3D en WebGL (Three.js):
//   1. 'saludo' -> Saluda al usuario cuando se ingresa al sistema
//   2. 'reposo' -> Estado de espera en la biblioteca
//   3. 'hablar' -> Estado de habla con movimiento articulado de pico y alas

let buhoActual = null;

function reproducirBuho(nombre, { loop = true, alTerminar = null } = {}) {
  buhoActual = nombre;

  if (avatarWrap) {
    avatarWrap.classList.toggle('saludando', nombre === 'saludo');
    avatarWrap.classList.toggle('esperando', nombre === 'reposo');
  }

  if (window.UtemitoAvatar3D && typeof window.UtemitoAvatar3D.setState === 'function') {
    window.UtemitoAvatar3D.setState(nombre, { loop, alTerminar });
  } else if (alTerminar && !loop) {
    setTimeout(alTerminar, 3500);
  }
}

function irAReposo() {
  reproducirBuho('reposo', { loop: true });
}

// Al entrar o recargar la pagina: el avatar 3D saluda al usuario y luego pasa a espera.
reproducirBuho('saludo', { loop: false, alTerminar: irAReposo });

// ============ Apartado Izquierdo: Enlaces, Correos y Telefonos ============

let recursosGuardados = []; // [{ id, tipo, valor, documento, seccion, hora }]
let filtroRecursoActual = 'todos';

const TIPO_CONFIG = {
  enlace: { label: '🔗 Enlace web', actionLabel: 'Abrir' },
  correo: { label: '✉️ Correo electrónico', actionLabel: 'Escribir' },
  telefono: { label: '📞 Teléfono / Ext.', actionLabel: 'Llamar' },
  fuente: { label: '📄 Fuente documental', actionLabel: 'Fuente' },
};

function extraerRecursosDeRespuesta(texto, contactosBackend = [], fuentes = []) {
  const hallados = [];
  const vistos = new Set();

  const agregar = (tipo, valor, documento = '', seccion = '') => {
    const limpio = (valor || '').trim().replace(/[.,;:)\]]+$/, '');
    if (!limpio) return;
    const clave = `${tipo}:${limpio.toLowerCase()}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    hallados.push({ tipo, valor: limpio, documento, seccion });
  };

  // 1. Contactos estructurados devueltos por el backend
  (contactosBackend || []).forEach((c) => {
    if (c && c.tipo && c.valor) {
      agregar(c.tipo, c.valor, c.documento || '', c.seccion || '');
    }
  });

  // 2. Deteccion directa sobre el texto de la respuesta de Utemito
  const raw = texto || '';

  // Enlaces HTTP/HTTPS y www.
  const urlMatches = raw.match(/\b(?:https?:\/\/|www\.)[^\s<>()\[\]"']+/gi) || [];
  urlMatches.forEach((u) => agregar('enlace', u));

  // Correos electronicos
  const emailMatches = raw.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [];
  emailMatches.forEach((e) => agregar('correo', e));

  // Telefonos y extensiones
  const phoneRegex = /(?:\+?593[\s.\-]?)?(?:\(?0?\d{1,2}\)?[\s.\-]?)?\d{3,4}[\s.\-]\d{4}\b|\b09\d{8}\b|\bext(?:\.|ensi[oó]n)?\s*\.?\s*\d{2,5}\b/gi;
  const phoneMatches = raw.match(phoneRegex) || [];
  phoneMatches.forEach((p) => {
    const digitos = p.replace(/\D/g, '');
    if (/ext/i.test(p) || digitos.length >= 7) {
      agregar('telefono', p);
    }
  });

  return hallados;
}

function registrarRecursosEnPanel(nuevosItems, fuentes = []) {
  if (!nuevosItems.length) return;

  const hora = new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
  const fuentePrincipal = fuentes && fuentes.length ? fuentes.join(', ') : '';
  let agregados = 0;

  nuevosItems.forEach((item) => {
    const clave = `${item.tipo}:${item.valor.toLowerCase()}`;
    const idxExistente = recursosGuardados.findIndex(
      (r) => `${r.tipo}:${r.valor.toLowerCase()}` === clave
    );
    const registro = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      tipo: item.tipo,
      valor: item.valor,
      documento: item.documento || fuentePrincipal,
      seccion: item.seccion || '',
      hora,
    };
    if (idxExistente !== -1) {
      recursosGuardados.splice(idxExistente, 1);
    }
    recursosGuardados.unshift(registro);
    agregados++;
  });

  if (agregados > 0) {
    renderizarPanelRecursos();
    if (recursosPanel) {
      recursosPanel.classList.add('destacado');
      setTimeout(() => recursosPanel.classList.remove('destacado'), 1800);
    }
  }
}

function renderizarPanelRecursos() {
  if (!recursosList) return;

  if (recursosCount) recursosCount.textContent = String(recursosGuardados.length);
  if (clearRecursosBtn) clearRecursosBtn.hidden = recursosGuardados.length === 0;

  const filtrados =
    filtroRecursoActual === 'todos'
      ? recursosGuardados
      : recursosGuardados.filter((r) => r.tipo === filtroRecursoActual);

  if (!filtrados.length) {
    recursosList.innerHTML = '';
    if (recursosEmpty) {
      recursosList.appendChild(recursosEmpty);
      recursosEmpty.hidden = false;
    }
    return;
  }

  if (recursosEmpty) recursosEmpty.hidden = true;
  recursosList.innerHTML = '';

  filtrados.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'recurso-card';
    card.setAttribute('data-tipo', item.tipo);

    const cfg = TIPO_CONFIG[item.tipo] || { label: item.tipo };

    const top = document.createElement('div');
    top.className = 'recurso-card-top';

    const tag = document.createElement('span');
    tag.className = 'recurso-tipo-tag';
    tag.textContent = cfg.label;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'recurso-copy-btn';
    copyBtn.textContent = 'Copiar';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(item.valor).then(() => {
        copyBtn.textContent = '¡Copiado!';
        setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 1400);
      }).catch(() => {});
    });

    top.appendChild(tag);
    top.appendChild(copyBtn);
    card.appendChild(top);

    let valorEl;
    if (item.tipo === 'enlace') {
      valorEl = document.createElement('a');
      valorEl.className = 'recurso-valor';
      valorEl.href = /^https?:\/\//i.test(item.valor) ? item.valor : `https://${item.valor}`;
      valorEl.target = '_blank';
      valorEl.rel = 'noopener noreferrer';
      valorEl.textContent = item.valor;
    } else if (item.tipo === 'correo') {
      valorEl = document.createElement('a');
      valorEl.className = 'recurso-valor';
      valorEl.href = `mailto:${item.valor}`;
      valorEl.textContent = item.valor;
    } else if (item.tipo === 'telefono' && !/ext/i.test(item.valor)) {
      valorEl = document.createElement('a');
      valorEl.className = 'recurso-valor';
      valorEl.href = `tel:${item.valor.replace(/[^\d+]/g, '')}`;
      valorEl.textContent = item.valor;
    } else {
      valorEl = document.createElement('div');
      valorEl.className = 'recurso-valor';
      valorEl.textContent = item.valor;
    }
    card.appendChild(valorEl);

    if (item.documento || item.hora) {
      const meta = document.createElement('div');
      meta.className = 'recurso-meta';
      const fuenteSpan = document.createElement('span');
      fuenteSpan.textContent = item.documento ? `📄 ${item.documento}` : 'En respuesta del chat';
      const horaSpan = document.createElement('span');
      horaSpan.textContent = item.hora || '';
      meta.appendChild(fuenteSpan);
      meta.appendChild(horaSpan);
      card.appendChild(meta);
    }

    recursosList.appendChild(card);
  });
}

if (recursosFilters) {
  recursosFilters.querySelectorAll('.recurso-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      recursosFilters.querySelectorAll('.recurso-filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      filtroRecursoActual = btn.dataset.filter || 'todos';
      renderizarPanelRecursos();
    });
  });
}

if (clearRecursosBtn) {
  clearRecursosBtn.addEventListener('click', () => {
    recursosGuardados = [];
    renderizarPanelRecursos();
  });
}

// ============ Chat de Texto (Columna Derecha) ============

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineFormat(str) {
  return linkify(
    str
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  );
}

// Convierte correos y URLs en enlaces clicables. Recibe texto ya escapado como
// HTML (por renderMarkdown), asi que no hay etiquetas < > reales que romper.
function linkify(str) {
  str = str.replace(
    /\bhttps?:\/\/[^\s<]+[^\s<.,;:)\]}"']/g,
    (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`
  );
  str = str.replace(
    /(^|[\s(>])(www\.[^\s<]+[^\s<.,;:)\]}"'])/g,
    (_m, pre, url) => `${pre}<a href="https://${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
  str = str.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    (m) => `<a href="mailto:${m}">${m}</a>`
  );
  return str;
}

// Convierte un subconjunto seguro de Markdown (negritas, listas, parrafos)
// a HTML, ya que la respuesta del modelo a veces incluye formato Markdown
// aunque se le pide texto plano.
function renderMarkdown(raw) {
  const lines = escapeHtml(raw).replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let listType = null; // 'ul' | 'ol' | null
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html += `<p>${paragraph.join('<br>')}</p>`;
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) { html += `</${listType}>`; listType = null; }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^#{1,6}\s*/, '');

    if (!line) { flushParagraph(); closeList(); continue; }

    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    const numberMatch = line.match(/^\d+[.)]\s+(.*)/);

    if (bulletMatch) {
      flushParagraph();
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
      html += `<li>${inlineFormat(bulletMatch[1])}</li>`;
    } else if (numberMatch) {
      flushParagraph();
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
      html += `<li>${inlineFormat(numberMatch[1])}</li>`;
    } else {
      closeList();
      paragraph.push(inlineFormat(line));
    }
  }
  flushParagraph();
  closeList();
  return html;
}

function crearHora() {
  const h = document.createElement('div');
  h.className = 'hora';
  h.textContent = new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
  return h;
}

function crearAvatarMensaje() {
  const a = document.createElement('div');
  a.className = 'msg-avatar';
  a.setAttribute('aria-hidden', 'true');
  a.innerHTML = '<img src="/logo.jpeg" alt="Utemito" />';
  return a;
}

// Envuelve cada palabra en un <span> con retraso escalonado para que la
// respuesta "aparezca" progresivamente. Conserva enlaces y negritas.
function revelarPalabras(root) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodos = [];
  while (walker.nextNode()) nodos.push(walker.currentNode);
  const total = nodos.reduce((n, t) => n + (t.nodeValue.match(/\S+/g) || []).length, 0);
  const paso = Math.min(40, 1800 / Math.max(total, 1));
  let i = 0;
  nodos.forEach((nodo) => {
    if (!nodo.nodeValue.trim()) return;
    const frag = document.createDocumentFragment();
    nodo.nodeValue.split(/(\s+)/).forEach((parte) => {
      if (!parte) return;
      if (/^\s+$/.test(parte)) { frag.appendChild(document.createTextNode(parte)); return; }
      const span = document.createElement('span');
      span.className = 'palabra';
      span.style.animationDelay = `${Math.round(i++ * paso)}ms`;
      span.textContent = parte;
      frag.appendChild(span);
    });
    nodo.parentNode.replaceChild(frag, nodo);
  });
}

function addUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-user';
  div.innerHTML = `<div class="msg-content"><div class="bubble"></div></div>`;
  div.querySelector('.bubble').textContent = text;
  div.querySelector('.msg-content').appendChild(crearHora());
  messagesEl.appendChild(div);
  scrollToBottom();
}

function addBotMessage(text, fuentes, contactos = []) {
  const div = document.createElement('div');
  div.className = 'msg msg-bot';
  div.appendChild(crearAvatarMensaje());

  const content = document.createElement('div');
  content.className = 'msg-content';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = renderMarkdown(text);
  revelarPalabras(bubble);
  content.appendChild(bubble);

  if (fuentes && fuentes.length) {
    const tagsWrap = document.createElement('div');
    tagsWrap.className = 'fuentes';
    fuentes.forEach((f, idx) => {
      const tag = document.createElement('span');
      tag.className = 'fuente-tag';
      tag.style.animationDelay = `${400 + idx * 90}ms`;
      tag.textContent = f;
      tagsWrap.appendChild(tag);
    });
    content.appendChild(tagsWrap);
  }

  // Extrae enlaces, correos y telefonos y los coloca en el apartado izquierdo del avatar
  const recursosExtraidos = extraerRecursosDeRespuesta(text, contactos, fuentes);
  if (recursosExtraidos.length > 0) {
    registrarRecursosEnPanel(recursosExtraidos, fuentes);
  }

  content.appendChild(crearHora());
  div.appendChild(content);
  messagesEl.appendChild(div);
  scrollToBottom();
  const t0 = Date.now();
  const seguir = setInterval(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (Date.now() - t0 > 2200) clearInterval(seguir);
  }, 120);
}

function addTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'msg msg-bot';
  div.id = 'typingIndicator';
  div.innerHTML = `<div class="msg-avatar" aria-hidden="true"><img src="/logo.jpeg" alt="Utemito" /></div><div class="msg-content"><div class="bubble"><span class="typing"><span></span><span></span><span></span></span></div></div>`;
  messagesEl.appendChild(div);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

function setBotState(state) {
  avatarWrap.classList.remove('pensando', 'hablando');
  if (state) avatarWrap.classList.add(state);

  if (window.UtemitoAvatar3D && typeof window.UtemitoAvatar3D.setSubState === 'function') {
    window.UtemitoAvatar3D.setSubState(state);
  }

  if (state === 'hablando') {
    reproducirBuho('hablar', { loop: true });
  } else if (state === 'pensando') {
    reproducirBuho('reposo', { loop: true });
  } else {
    irAReposo();
  }
}

async function sendMessage(text, opts = {}) {
  if (!text.trim()) {
    if (voiceModeActive) startListening();
    return;
  }

  if (hablarTimeoutId) {
    clearTimeout(hablarTimeoutId);
    hablarTimeoutId = null;
  }

  addUserMessage(text);
  history.push({ role: 'user', content: text });

  inputEl.value = '';
  sendBtn.disabled = true;
  setBotState('pensando');
  avatarCaption.textContent = 'Utemito está buscando en los documentos...';
  addTypingIndicator();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history }),
    });

    const data = await res.json();
    removeTypingIndicator();

    if (!res.ok) {
      throw new Error(data.detail || 'Ocurrió un error al consultar al búho.');
    }

    addBotMessage(data.respuesta, data.fuentes, data.contactos || []);
    history.push({ role: 'assistant', content: data.respuesta });

    if (voiceModeActive) {
      await speak(data.respuesta);
    } else {
      setBotState('hablando');
      avatarCaption.textContent = '¡Aquí tienes tu respuesta!';
      const palabras = (data.respuesta || '').split(/\s+/).length;
      const duracionHablar = Math.min(5200, Math.max(3200, palabras * 85));
      hablarTimeoutId = setTimeout(() => {
        setBotState(null);
        avatarCaption.innerHTML = DEFAULT_CAPTION;
        hablarTimeoutId = null;
      }, duracionHablar);
    }

  } catch (err) {
    removeTypingIndicator();
    setBotState(null);
    addBotMessage(`Lo siento, tuve un problema: ${err.message}`, []);
    avatarCaption.textContent = 'Algo salió mal. Intenta de nuevo.';
  } finally {
    sendBtn.disabled = false;
    if (!opts.spoken) inputEl.focus();
    if (voiceModeActive) startListening();
  }
}

formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage(inputEl.value);
});

// ============ Modo oscuro ============

const THEME_KEY = 'utemito_theme';
const themeToggleBtn = document.getElementById('themeToggleBtn');

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  if (themeToggleBtn) {
    themeToggleBtn.textContent = tema === 'dark' ? '☀️' : '🌙';
    themeToggleBtn.title = tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    themeToggleBtn.setAttribute('aria-label', themeToggleBtn.title);
  }
}

(function inicializarTema() {
  let guardado = null;
  try { guardado = localStorage.getItem(THEME_KEY); } catch (e) {}
  aplicarTema(guardado === 'dark' ? 'dark' : 'light');
})();

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const actual = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const nuevo = actual === 'dark' ? 'light' : 'dark';
    aplicarTema(nuevo);
    try { localStorage.setItem(THEME_KEY, nuevo); } catch (e) {}
  });
}

// ============ Voz: reconocimiento (STT) y sintesis (TTS) ============

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechRecognitionSupported = !!SpeechRecognitionAPI;
const speechSynthesisSupported = 'speechSynthesis' in window;

let voiceModeActive = false;
let isSingleListening = false;
let activeRecognition = null;
let spanishVoice = null;

const BRAVE_MSG = 'Brave bloquea el reconocimiento de voz gratuito de Google por privacidad. Usa Google Chrome o Microsoft Edge para esta función.';

const voiceModeLabel = document.getElementById('voiceModeLabel');
const voiceModeHint = document.getElementById('voiceModeHint');

function mostrarAvisoVoz(mensaje) {
  if (!voiceModeHint) return;
  voiceModeHint.textContent = mensaje;
  voiceModeHint.hidden = false;
}

function disableVoiceButtonsForBrave() {
  if (micBtn) { micBtn.disabled = true; micBtn.title = BRAVE_MSG; }
  if (voiceModeBtn) { voiceModeBtn.disabled = true; voiceModeBtn.title = BRAVE_MSG; }
  mostrarAvisoVoz(BRAVE_MSG);
}

if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
  navigator.brave.isBrave().then((isBrave) => {
    if (isBrave) disableVoiceButtonsForBrave();
  }).catch(() => {});
}

const NOMBRES_VOZ_MASCULINA = [
  'alvaro', 'jorge', 'gonzalo', 'tomas', 'alonso', 'andres', 'liam', 'rodrigo',
  'pablo', 'raul', 'jacinto', 'juan', 'diego', 'carlos', 'enrique', 'miguel',
  'male', 'hombre', 'masculin',
];

function esNombreVozMasculina(voice) {
  const nombre = voice.name.toLowerCase();
  return NOMBRES_VOZ_MASCULINA.some((clave) => nombre.includes(clave));
}

function pickSpanishVoice() {
  if (!speechSynthesisSupported) return;
  const voices = speechSynthesis.getVoices();
  const esVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('es'));
  const esNatural = (v) => /natural|online|neural/i.test(v.name);

  const masculinasNaturales = esVoices.filter((v) => esNombreVozMasculina(v) && esNatural(v));
  const masculinas = esVoices.filter(esNombreVozMasculina);
  const naturales = esVoices.filter(esNatural);

  spanishVoice =
    masculinasNaturales[0] ||
    masculinas.find((v) => v.lang === 'es-EC') ||
    masculinas.find((v) => v.lang === 'es-419') ||
    masculinas[0] ||
    naturales[0] ||
    esVoices.find((v) => v.lang === 'es-EC') ||
    esVoices.find((v) => v.lang === 'es-419') ||
    esVoices[0] ||
    null;
}
if (speechSynthesisSupported) {
  pickSpanishVoice();
  speechSynthesis.onvoiceschanged = pickSpanishVoice;
}

function createRecognition({ interim = true } = {}) {
  const r = new SpeechRecognitionAPI();
  r.lang = 'es-EC';
  r.continuous = false;
  r.interimResults = interim;
  r.maxAlternatives = 1;
  return r;
}

function attachDiagnostics(r, label) {
  r.onstart = () => console.log(`[voz:${label}] iniciado, esperando audio...`);
  r.onaudiostart = () => console.log(`[voz:${label}] micrófono activo`);
  r.onsoundstart = () => console.log(`[voz:${label}] sonido detectado`);
  r.onspeechstart = () => console.log(`[voz:${label}] voz detectada`);
  r.onspeechend = () => console.log(`[voz:${label}] fin de voz`);
  r.onnomatch = () => console.log(`[voz:${label}] hubo audio pero no se pudo reconocer texto`);
}

function describeSpeechError(errorCode) {
  const mensajes = {
    'not-allowed': 'Bloqueaste el permiso del micrófono. Haz clic en el ícono de candado/micrófono en la barra de direcciones y permite el acceso.',
    'service-not-allowed': 'El navegador bloqueó el servicio de reconocimiento de voz.',
    'no-speech': 'No te escuché decir nada, intenta de nuevo.',
    'audio-capture': 'No se encontró ningún micrófono conectado.',
    'network': 'Sin conexión al servicio de reconocimiento de voz de Google. Si usas Brave, Opera u otro navegador que no sea Chrome/Edge, esta función no está disponible por diseño de ese navegador.',
    'aborted': 'Reconocimiento de voz interrumpido.',
    'language-not-supported': 'El idioma de reconocimiento no está disponible en este navegador.',
  };
  return mensajes[errorCode] || `Error de voz: ${errorCode}`;
}

let currentTtsAudio = null;

function stopActiveSpeech() {
  if (currentTtsAudio) {
    try {
      currentTtsAudio.pause();
      currentTtsAudio.src = '';
    } catch (e) {}
    currentTtsAudio = null;
  }
  if (speechSynthesisSupported) {
    speechSynthesis.cancel();
  }
}

async function speak(text) {
  const clean = (text || '')
    .replace(/https?:\/\/\S+/gi, ' el enlace que aparece en el panel izquierdo ')
    .replace(/\bwww\.\S+/gi, ' el enlace que aparece en el panel izquierdo ')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' el correo que aparece en el panel izquierdo ')
    .replace(/[*_#`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return;

  stopActiveSpeech();

  // 1. Intenta primero la voz neuronal humana y amigable del backend (/api/tts - es-EC-LuisNeural)
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean }),
    });
    if (res.ok) {
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      await new Promise((resolve) => {
        const audio = new Audio(audioUrl);
        currentTtsAudio = audio;
        const finish = () => {
          URL.revokeObjectURL(audioUrl);
          if (currentTtsAudio === audio) currentTtsAudio = null;
          setBotState(null);
          avatarCaption.innerHTML = DEFAULT_CAPTION;
          resolve();
        };
        audio.onplay = () => {
          setBotState('hablando');
          avatarCaption.textContent = 'Utemito está hablando...';
        };
        audio.onended = finish;
        audio.onerror = finish;
        audio.play().catch(finish);
      });
      return;
    }
  } catch (err) {
    console.warn('Usando sintesis de voz del navegador como respaldo:', err);
  }

  // 2. Respaldo local con prosodia natural y amigable (sin tono robotico)
  if (!speechSynthesisSupported) return;
  await new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = (spanishVoice && spanishVoice.lang) ? spanishVoice.lang : 'es-EC';
    if (spanishVoice) utter.voice = spanishVoice;
    utter.rate = 1.25;
    utter.pitch = 1.03;

    utter.onstart = () => {
      setBotState('hablando');
      avatarCaption.textContent = 'Utemito está hablando...';
    };
    const finish = () => {
      setBotState(null);
      avatarCaption.innerHTML = DEFAULT_CAPTION;
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;

    speechSynthesis.speak(utter);
  });
}

// --- Boton de microfono: dicta una sola pregunta por voz ---
if (micBtn) {
  if (!speechRecognitionSupported) {
    micBtn.disabled = true;
    micBtn.title = 'Tu navegador no soporta reconocimiento de voz (usa Chrome o Edge)';
  } else {
    micBtn.addEventListener('click', () => {
      if (voiceModeActive || isSingleListening) return;

      const r = createRecognition();
      attachDiagnostics(r, 'mic');
      isSingleListening = true;
      micBtn.classList.add('recording');
      avatarCaption.textContent = 'Escuchando... 🎤';
      inputEl.value = '';
      inputEl.placeholder = 'Escuchando...';

      r.onresult = (e) => {
        let finalTranscript = '';
        let interimTranscript = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const transcript = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalTranscript += transcript;
          else interimTranscript += transcript;
        }
        if (interimTranscript) {
          inputEl.value = interimTranscript;
        }
        if (finalTranscript) {
          inputEl.value = finalTranscript;
          sendMessage(finalTranscript);
        }
      };
      r.onerror = (e) => {
        console.error('SpeechRecognition error:', e.error);
        avatarCaption.textContent = describeSpeechError(e.error);
        setTimeout(() => { avatarCaption.innerHTML = DEFAULT_CAPTION; }, 4000);
      };
      r.onend = () => {
        isSingleListening = false;
        micBtn.classList.remove('recording');
        inputEl.placeholder = 'Escribe tu pregunta sobre trámites de la UTM...';
      };
      try {
        r.start();
      } catch (err) {
        isSingleListening = false;
        micBtn.classList.remove('recording');
        avatarCaption.textContent = 'No se pudo iniciar el micrófono: ' + err.message;
      }
    });
  }
}

// --- Modo conversacion: dialogo continuo por voz con Utemito ---
const MAX_FALLOS_SEGUIDOS = 5;
let fallosSeguidos = 0;
let listeningStartToken = 0;

function startListening() {
  if (!voiceModeActive) return;

  const myToken = ++listeningStartToken;

  const r = createRecognition();
  attachDiagnostics(r, 'dialogo');
  activeRecognition = r;
  let handled = false;
  let lastErrorCode = null;

  avatarWrap.classList.add('escuchando');
  if (window.UtemitoAvatar3D && typeof window.UtemitoAvatar3D.setSubState === 'function') {
    window.UtemitoAvatar3D.setSubState('escuchando');
  }
  avatarCaption.textContent = 'Te escucho... habla ahora 🎤';

  r.onresult = (e) => {
    let finalTranscript = '';
    let interimTranscript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalTranscript += transcript;
      else interimTranscript += transcript;
    }
    if (interimTranscript && !handled) {
      avatarCaption.textContent = `"${interimTranscript}"`;
    }
    if (finalTranscript) {
      handled = true;
      fallosSeguidos = 0;
      avatarWrap.classList.remove('escuchando');
      if (window.UtemitoAvatar3D && typeof window.UtemitoAvatar3D.setSubState === 'function') {
        window.UtemitoAvatar3D.setSubState(null);
      }
      sendMessage(finalTranscript, { spoken: true });
    }
  };

  r.onerror = (e) => {
    lastErrorCode = e.error;
    console.error('SpeechRecognition error (modo conversacion):', e.error);
  };

  r.onend = () => {
    if (handled) return;
    avatarWrap.classList.remove('escuchando');
    if (window.UtemitoAvatar3D && typeof window.UtemitoAvatar3D.setSubState === 'function') {
      window.UtemitoAvatar3D.setSubState(null);
    }
    if (myToken !== listeningStartToken) return;
    if (!voiceModeActive) return;

    const ERRORES_PERMANENTES = ['not-allowed', 'service-not-allowed', 'network', 'audio-capture', 'language-not-supported'];
    if (ERRORES_PERMANENTES.includes(lastErrorCode)) {
      avatarCaption.textContent = describeSpeechError(lastErrorCode);
      stopVoiceMode();
      return;
    }

    fallosSeguidos += 1;
    if (fallosSeguidos >= MAX_FALLOS_SEGUIDOS) {
      avatarCaption.textContent = 'No logro escucharte después de varios intentos. Revisa tu micrófono y vuelve a intentar.';
      stopVoiceMode();
      return;
    }

    if (lastErrorCode) avatarCaption.textContent = describeSpeechError(lastErrorCode);
    setTimeout(() => { if (voiceModeActive) startListening(); }, 900);
  };

  try {
    r.start();
  } catch (err) {
    avatarWrap.classList.remove('escuchando');
    avatarCaption.textContent = 'No se pudo iniciar el micrófono: ' + err.message;
  }
}

function stopVoiceMode() {
  voiceModeActive = false;
  listeningStartToken++;
  fallosSeguidos = 0;
  voiceModeBtn.classList.remove('active');
  if (voiceModeLabel) voiceModeLabel.textContent = 'Hablar con Utemito';
  if (activeRecognition) { try { activeRecognition.abort(); } catch (e) {} }
  stopActiveSpeech();
  avatarWrap.classList.remove('escuchando');
  setBotState(null);
  avatarCaption.innerHTML = DEFAULT_CAPTION;
}

if (voiceModeBtn) {
  if (!speechRecognitionSupported || !speechSynthesisSupported) {
    const motivo = !speechRecognitionSupported
      ? 'Tu navegador no soporta reconocimiento de voz (usa Chrome o Edge).'
      : 'Tu navegador no soporta sintesis de voz (usa Chrome o Edge).';
    voiceModeBtn.disabled = true;
    voiceModeBtn.title = motivo;
    mostrarAvisoVoz(motivo);
  } else {
    voiceModeBtn.addEventListener('click', () => {
      if (voiceModeActive) {
        stopVoiceMode();
      } else {
        voiceModeActive = true;
        fallosSeguidos = 0;
        voiceModeBtn.classList.add('active');
        if (voiceModeLabel) voiceModeLabel.textContent = 'Detener conversación';
        startListening();
      }
    });
  }
}
