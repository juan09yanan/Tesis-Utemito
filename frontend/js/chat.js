const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('chatForm');
const inputEl = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const voiceModeBtn = document.getElementById('voiceModeBtn');
const avatarWrap = document.getElementById('avatarWrap');
const avatarCaption = document.getElementById('avatarCaption');
const buhoVideo = document.getElementById('buhoVideo');

const DEFAULT_CAPTION = '¡Hola! Soy Utemito 🦉<br>Pregúntame sobre trámites de la FCI-UTM';

let history = [];

// ============ Video del buho (saludar / reposo / hablar) ============
// Reemplaza al buho SVG animado: 3 videos sin audio (para no interrumpir la
// voz de las respuestas) que se van encadenando segun el estado del asistente.

const BUHO_VIDEOS = {
  saludo: '/animaciones/saludar.mp4',
  reposo: '/animaciones/reposo.mp4',
  hablar: '/animaciones/hablar.mp4',
};

let buhoActual = null;

function reproducirBuho(nombre, { loop = true, alTerminar = null } = {}) {
  const src = BUHO_VIDEOS[nombre];
  if (!buhoVideo || !src) return;

  // Si ya es el video activo en bucle, no lo reiniciamos (evita "saltos" visuales).
  if (buhoActual === nombre && loop && !buhoVideo.paused) return;

  buhoActual = nombre;
  buhoVideo.loop = loop;
  buhoVideo.onended = null;

  if (!buhoVideo.currentSrc || !buhoVideo.currentSrc.endsWith(src)) {
    buhoVideo.src = src;
  }
  if (alTerminar) {
    buhoVideo.onended = () => {
      buhoVideo.onended = null;
      alTerminar();
    };
  }
  buhoVideo.currentTime = 0;
  buhoVideo.play().catch(() => {
    // Autoplay bloqueado (poco probable, el video no tiene audio): reintenta con un gesto del usuario.
  });
}

function irAReposo() {
  reproducirBuho('reposo', { loop: true });
}

// Al entrar o recargar la pagina: Utemito saluda una vez y luego queda en reposo.
reproducirBuho('saludo', { loop: false, alTerminar: irAReposo });

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

function addUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-user';
  div.innerHTML = `<div class="msg-content"><div class="bubble"></div></div>`;
  div.querySelector('.bubble').textContent = text;
  messagesEl.appendChild(div);
  scrollToBottom();
}

function addBotMessage(text, fuentes) {
  const div = document.createElement('div');
  div.className = 'msg msg-bot';

  const content = document.createElement('div');
  content.className = 'msg-content';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = renderMarkdown(text);
  content.appendChild(bubble);

  if (fuentes && fuentes.length) {
    const tagsWrap = document.createElement('div');
    tagsWrap.className = 'fuentes';
    fuentes.forEach(f => {
      const tag = document.createElement('span');
      tag.className = 'fuente-tag';
      tag.textContent = f;
      tagsWrap.appendChild(tag);
    });
    content.appendChild(tagsWrap);
  }

  div.appendChild(content);
  messagesEl.appendChild(div);
  scrollToBottom();
}

function addTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'msg msg-bot';
  div.id = 'typingIndicator';
  div.innerHTML = `<div class="msg-content"><div class="bubble"><span class="typing"><span></span><span></span><span></span></span></div></div>`;
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

  // El video "hablar" solo se reproduce mientras el estado es "hablando"
  // (respondiendo por voz o mostrando la respuesta); en cualquier otro
  // momento (pensando, escuchando o en reposo) vuelve al video de reposo.
  if (state === 'hablando') {
    reproducirBuho('hablar', { loop: true });
  } else {
    irAReposo();
  }
}

async function sendMessage(text, opts = {}) {
  if (!text.trim()) {
    if (voiceModeActive) startListening();
    return;
  }

  addUserMessage(text);
  history.push({ role: 'user', content: text });

  inputEl.value = '';
  sendBtn.disabled = true;
  setBotState('pensando');
  avatarCaption.textContent = 'Utemito está pensando...';
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

    addBotMessage(data.respuesta, data.fuentes);
    history.push({ role: 'assistant', content: data.respuesta });

    if (voiceModeActive) {
      await speak(data.respuesta);
    } else {
      setBotState('hablando');
      avatarCaption.textContent = '¡Aquí tienes tu respuesta!';
      setTimeout(() => {
        setBotState(null);
        avatarCaption.innerHTML = DEFAULT_CAPTION;
      }, 1500);
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
// Usa la Web Speech API nativa del navegador (gratis, sin backend ni API keys).
// Soportada en Chrome/Edge; en navegadores sin soporte los botones se deshabilitan.

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechRecognitionSupported = !!SpeechRecognitionAPI;
const speechSynthesisSupported = 'speechSynthesis' in window;

let voiceModeActive = false;
let isSingleListening = false;
let activeRecognition = null;
let spanishVoice = null;

// Brave existe en el API pero SIEMPRE falla con error "network": Brave omite
// a proposito la clave de Google necesaria para el servicio de reconocimiento
// de voz en linea (decision de privacidad del navegador, no un bug de la app).
// Lo detectamos para avisar antes de que el usuario haga clic, en vez de que
// se encuentre con un error confuso despues.
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

// Nombres tipicos de voces masculinas en espanol que instalan Windows/Edge,
// Chrome/Google y macOS/iOS. La Web Speech API no expone el genero de la voz,
// asi que lo inferimos por el nombre (heuristica, no hay forma exacta).
const NOMBRES_VOZ_MASCULINA = [
  // Voces "Online (Natural)"/neuronales de Edge moderno (suenan mas humanas)
  'alvaro', 'jorge', 'gonzalo', 'tomas', 'alonso', 'andres', 'liam', 'rodrigo',
  // Voces clasicas de escritorio (Windows SAPI) y otras plataformas
  'pablo', 'raul', 'jacinto', 'juan', 'diego', 'carlos', 'enrique', 'miguel',
  // Genericos
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

  console.log(
    '[Utemito] Voces en español disponibles:',
    esVoices.map((v) => v.name + ' (' + v.lang + ')')
  );
  console.log(
    '[Utemito] Voz elegida para Utemito:',
    spanishVoice ? spanishVoice.name + ' (' + spanishVoice.lang + ')' : '(ninguna; usará la voz por defecto del navegador)'
  );
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

// Registra en consola cada etapa del reconocimiento, para diagnosticar donde
// se traba (permiso -> microfono activo -> sonido detectado -> voz detectada -> resultado).
function attachDiagnostics(r, label) {
  r.onstart = () => console.log(`[voz:${label}] iniciado, esperando audio...`);
  r.onaudiostart = () => console.log(`[voz:${label}] micrófono activo (audio llegando al navegador)`);
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
    'network': 'Sin conexión al servicio de reconocimiento de voz de Google. Si usas Brave, Opera u otro navegador que no sea Chrome/Edge, esta función no está disponible por diseño de ese navegador (revisa Chrome/Edge si el problema persiste, o tu internet/firewall).',
    'aborted': 'Reconocimiento de voz interrumpido.',
    'language-not-supported': 'El idioma de reconocimiento no está disponible en este navegador.',
  };
  return mensajes[errorCode] || `Error de voz: ${errorCode}`;
}

function speak(text) {
  return new Promise((resolve) => {
    if (!speechSynthesisSupported) { resolve(); return; }
    // Para la voz: no leer URLs ni correos caracter por caracter (suena fatal).
    const clean = text
      .replace(/https?:\/\/\S+/gi, ' el enlace que aparece en pantalla ')
      .replace(/\bwww\.\S+/gi, ' el enlace que aparece en pantalla ')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' el correo que aparece en pantalla ')
      .replace(/[*_#`>]/g, '')
      .trim();
    if (!clean) { resolve(); return; }

    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = 'es-EC';
    if (spanishVoice) utter.voice = spanishVoice;
    utter.rate = 1.15; // un poco mas fluida que el ritmo por defecto (1.0)
    utter.pitch = 0.85; // tono un poco mas grave/masculino

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
          console.log('[voz:mic] texto parcial:', interimTranscript);
          inputEl.value = interimTranscript;
        }
        if (finalTranscript) {
          console.log('[voz:mic] texto final:', finalTranscript);
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
        inputEl.placeholder = 'Escribe tu pregunta sobre trámites de la FCI...';
      };
      try {
        r.start();
      } catch (err) {
        console.error('No se pudo iniciar el reconocimiento de voz:', err);
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

  // Token para asegurarnos de que solo haya un ciclo de escucha "vivo" a la vez:
  // si se programa una nueva llamada mientras otra ya arranco, esta se ignora.
  const myToken = ++listeningStartToken;

  const r = createRecognition();
  attachDiagnostics(r, 'dialogo');
  activeRecognition = r;
  let handled = false;
  let lastErrorCode = null;

  avatarWrap.classList.add('escuchando');
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
      console.log('[voz:dialogo] texto parcial:', interimTranscript);
      avatarCaption.textContent = `"${interimTranscript}"`;
    }
    if (finalTranscript) {
      handled = true;
      fallosSeguidos = 0;
      console.log('[voz:dialogo] texto final:', finalTranscript);
      avatarWrap.classList.remove('escuchando');
      sendMessage(finalTranscript, { spoken: true });
    }
  };

  // onerror SIEMPRE va seguido de onend en esta API: onerror solo registra
  // la causa, y es onend (unico) quien decide si reintentar. Programar el
  // reintento en los dos provoca reconocimientos duplicados que se abortan
  // entre si (bucle infinito de errores "aborted").
  r.onerror = (e) => {
    lastErrorCode = e.error;
    console.error('SpeechRecognition error (modo conversacion):', e.error);
  };

  r.onend = () => {
    if (handled) return;
    avatarWrap.classList.remove('escuchando');
    if (myToken !== listeningStartToken) return; // ya se inicio otro ciclo, no dupliques
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
    console.error('No se pudo iniciar el reconocimiento de voz:', err);
    avatarWrap.classList.remove('escuchando');
    avatarCaption.textContent = 'No se pudo iniciar el micrófono: ' + err.message;
  }
}

function stopVoiceMode() {
  voiceModeActive = false;
  listeningStartToken++; // invalida cualquier reintento pendiente de startListening
  fallosSeguidos = 0;
  voiceModeBtn.classList.remove('active');
  if (voiceModeLabel) voiceModeLabel.textContent = 'Hablar con Utemito';
  if (activeRecognition) { try { activeRecognition.abort(); } catch (e) {} }
  if (speechSynthesisSupported) speechSynthesis.cancel();
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
    console.warn('[Utemito] Modo voz deshabilitado:', motivo, {
      speechRecognitionSupported,
      speechSynthesisSupported,
    });
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
