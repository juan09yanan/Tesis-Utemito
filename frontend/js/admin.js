// Panel de administracion de Utemito: subir (mediante ventana emergente),
// listar en la seccion derecha, borrar y reindexar los documentos que forman
// la base de conocimiento del buho.

const ACCEPTED = ['.md', '.txt', '.pdf', '.docx'];
const TOKEN_KEY = 'utemito_admin_token';

const $ = (id) => document.getElementById(id);

const tokenCard = $('tokenCard');
const tokenForm = $('tokenForm');
const tokenInput = $('tokenInput');
const tokenError = $('tokenError');
const panel = $('panel');

// Modal de subida de documentos
const openUploadModalBtn = $('openUploadModalBtn');
const uploadModal = $('uploadModal');
const closeUploadModalBtn = $('closeUploadModalBtn');
const cancelUploadModalBtn = $('cancelUploadModalBtn');

const dropzone = $('dropzone');
const fileInput = $('fileInput');
const fileQueue = $('fileQueue');
const uploadBtn = $('uploadBtn');
const clearQueueBtn = $('clearQueueBtn');

const docTableBody = $('docTableBody');
const docSearchInput = $('docSearchInput');
const statDocs = $('statDocs');
const statChunks = $('statChunks');
const reindexBtn = $('reindexBtn');
const refreshBtn = $('refreshBtn');

const contactsTableBody = $('contactsTableBody');
const refreshContactsBtn = $('refreshContactsBtn');
const TIPO_LABEL = { correo: 'Correo', telefono: 'Teléfono', enlace: 'Enlace' };

let adminToken = localStorage.getItem(TOKEN_KEY) || '';
let queue = []; // File[]
let cachedDocs = [];

// ---------- Utilidades ----------

function authHeaders(extra = {}) {
  return adminToken ? { 'X-Admin-Token': adminToken, ...extra } : { ...extra };
}

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

function toast(msg, tipo = 'ok', ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast' + (tipo === 'ok' ? '' : ' ' + tipo);
  el.textContent = msg;
  $('toastStack').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, ms);
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: authHeaders(options.headers) });
  if (res.status === 401) {
    showTokenCard('El token de administrador no es válido.');
    throw new Error('No autorizado');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
  return data;
}

// ---------- Ventana Emergente (Modal) ----------

function abrirModalSubida() {
  if (!uploadModal) return;
  uploadModal.hidden = false;
  setTimeout(() => dropzone?.focus(), 50);
}

function cerrarModalSubida() {
  if (!uploadModal) return;
  uploadModal.hidden = true;
}

if (openUploadModalBtn) {
  openUploadModalBtn.addEventListener('click', abrirModalSubida);
}
if (closeUploadModalBtn) {
  closeUploadModalBtn.addEventListener('click', cerrarModalSubida);
}
if (cancelUploadModalBtn) {
  cancelUploadModalBtn.addEventListener('click', cerrarModalSubida);
}
if (uploadModal) {
  uploadModal.addEventListener('click', (e) => {
    if (e.target === uploadModal) cerrarModalSubida();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && uploadModal && !uploadModal.hidden) {
    cerrarModalSubida();
  }
});

// ---------- Acceso por token ----------

function showTokenCard(errorMsg) {
  panel.hidden = true;
  tokenCard.hidden = false;
  cerrarModalSubida();
  if (errorMsg) {
    tokenError.textContent = errorMsg;
    tokenError.hidden = false;
  }
}

function showPanel() {
  tokenCard.hidden = true;
  panel.hidden = false;
}

tokenForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  adminToken = tokenInput.value.trim();
  localStorage.setItem(TOKEN_KEY, adminToken);
  tokenError.hidden = true;
  await init();
});

// ---------- Cola de subida ----------

function renderQueue() {
  fileQueue.innerHTML = '';
  queue.forEach((file, idx) => {
    const li = document.createElement('li');
    const malFormato = !ACCEPTED.includes(extOf(file.name));
    if (malFormato) li.className = 'bad';
    li.innerHTML = `
      <span class="fq-name"></span>
      <span class="fq-size"></span>
      <button class="fq-remove" type="button" title="Quitar" aria-label="Quitar">&times;</button>`;
    li.querySelector('.fq-name').textContent = file.name + (malFormato ? '  (formato no aceptado)' : '');
    li.querySelector('.fq-size').textContent = fmtSize(file.size);
    li.querySelector('.fq-remove').addEventListener('click', () => {
      queue.splice(idx, 1);
      renderQueue();
    });
    fileQueue.appendChild(li);
  });

  const validos = queue.filter((f) => ACCEPTED.includes(extOf(f.name)));
  uploadBtn.disabled = validos.length === 0;
  clearQueueBtn.disabled = queue.length === 0;
}

function addFiles(fileList) {
  for (const f of fileList) {
    if (!queue.some((q) => q.name === f.name && q.size === f.size)) queue.push(f);
  }
  renderQueue();
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); })
);
dropzone.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

clearQueueBtn.addEventListener('click', () => { queue = []; renderQueue(); });

uploadBtn.addEventListener('click', async () => {
  const validos = queue.filter((f) => ACCEPTED.includes(extOf(f.name)));
  if (!validos.length) return;

  const form = new FormData();
  validos.forEach((f) => form.append('files', f, f.name));

  uploadBtn.disabled = true;
  uploadBtn.innerHTML = '<span class="spinner"></span>Subiendo…';
  try {
    const data = await apiFetch('/api/admin/upload', { method: 'POST', body: form });
    let huboError = false;
    (data.archivos || []).forEach((a) => {
      const tipo = a.estado === 'ok' ? (a.fragmentos ? 'ok' : 'warn') : 'err';
      if (a.estado !== 'ok') huboError = true;
      toast(`${a.nombre}: ${a.detalle}`, tipo);
    });
    queue = [];
    renderQueue();
    await Promise.all([cargarDocumentos(), cargarContactos()]);
    if (!huboError) {
      cerrarModalSubida();
    }
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Subir e indexar';
  }
});

// ---------- Tabla de documentos (Seccion Derecha) ----------

function badge(doc) {
  if (!doc.archivo_presente) return '<span class="badge badge-err">Archivo faltante</span>';
  if (doc.indexado && doc.fragmentos > 0) return '<span class="badge badge-ok">Indexado</span>';
  return '<span class="badge badge-warn">Sin indexar</span>';
}

function renderTabla(docs) {
  const termino = (docSearchInput?.value || '').trim().toLowerCase();
  const filtrados = termino
    ? docs.filter((d) => d.nombre.toLowerCase().includes(termino))
    : docs;

  if (!filtrados.length) {
    docTableBody.innerHTML = termino
      ? '<tr><td colspan="5" class="muted center">Ningún documento coincide con tu búsqueda.</td></tr>'
      : '<tr><td colspan="5" class="muted center">No hay documentos todavía. Usa el botón «Subir nuevo documento» para agregar el primero.</td></tr>';
    return;
  }
  docTableBody.innerHTML = '';
  filtrados.forEach((doc) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="doc-name"></td>
      <td class="num"></td>
      <td class="num"></td>
      <td></td>
      <td class="actions-col">
        <button class="btn btn-danger btn-sm" type="button">Eliminar</button>
      </td>`;
    tr.children[0].textContent = `📄 ${doc.nombre}`;
    tr.children[1].textContent = doc.archivo_presente ? fmtSize(doc.tamano_kb * 1024) : '—';
    tr.children[2].textContent = doc.fragmentos;
    tr.children[3].innerHTML = badge(doc);
    tr.querySelector('button').addEventListener('click', () => eliminarDocumento(doc.nombre));
    docTableBody.appendChild(tr);
  });
}

if (docSearchInput) {
  docSearchInput.addEventListener('input', () => renderTabla(cachedDocs));
}

async function cargarDocumentos() {
  try {
    const data = await apiFetch('/api/admin/documents');
    showPanel();
    cachedDocs = data.documentos || [];
    statDocs.textContent = data.total_documentos ?? cachedDocs.length;
    statChunks.textContent = data.total_fragmentos ?? 0;
    renderTabla(cachedDocs);
  } catch (err) {
    if (err.message !== 'No autorizado') {
      showPanel();
      toast(err.message, 'err');
      docTableBody.innerHTML = '<tr><td colspan="5" class="muted center">No se pudo cargar la lista.</td></tr>';
    }
  }
}

async function eliminarDocumento(nombre) {
  if (!confirm(`¿Eliminar "${nombre}" de la base de conocimiento?\n\nSe borra el archivo y todos sus fragmentos indexados.`)) return;
  try {
    await apiFetch(`/api/admin/documents/${encodeURIComponent(nombre)}`, { method: 'DELETE' });
    toast(`"${nombre}" eliminado.`, 'ok');
    await Promise.all([cargarDocumentos(), cargarContactos()]);
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ---------- Tabla de contactos extraidos ----------

function renderTablaContactos(contactos) {
  if (!contactos.length) {
    contactsTableBody.innerHTML = '<tr><td colspan="4" class="muted center">Todavía no se ha detectado ningún dato de contacto.</td></tr>';
    return;
  }
  contactsTableBody.innerHTML = '';
  contactos.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="doc-name"></td><td></td><td></td><td></td>';
    tr.children[0].textContent = c.documento;
    tr.children[1].textContent = c.seccion || '—';
    tr.children[2].textContent = TIPO_LABEL[c.tipo] || c.tipo;
    tr.children[3].textContent = c.valor;
    contactsTableBody.appendChild(tr);
  });
}

async function cargarContactos() {
  try {
    const data = await apiFetch('/api/admin/contacts');
    renderTablaContactos(data.contactos || []);
  } catch (err) {
    if (err.message !== 'No autorizado') {
      toast(err.message, 'err');
      contactsTableBody.innerHTML = '<tr><td colspan="4" class="muted center">No se pudo cargar la lista.</td></tr>';
    }
  }
}

reindexBtn.addEventListener('click', async () => {
  if (!confirm('Reindexar borra la base vectorial y vuelve a procesar todos los documentos de la carpeta. ¿Continuar?')) return;
  reindexBtn.disabled = true;
  reindexBtn.innerHTML = '<span class="spinner"></span>Reindexando…';
  try {
    const data = await apiFetch('/api/admin/reindex', { method: 'POST' });
    const errores = (data.archivos || []).filter((a) => a.estado === 'error');
    if (errores.length) {
      toast(`Reindexado con ${errores.length} error(es). Total: ${data.total_fragmentos} fragmentos.`, 'warn');
    } else {
      toast(`Reindexado completo: ${data.archivos.length} documento(s), ${data.total_fragmentos} fragmentos.`, 'ok');
    }
    await Promise.all([cargarDocumentos(), cargarContactos()]);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    reindexBtn.disabled = false;
    reindexBtn.textContent = '🔄 Reindexar toda la base';
  }
});

refreshBtn.addEventListener('click', cargarDocumentos);
refreshContactsBtn.addEventListener('click', cargarContactos);

// ---------- Arranque en paralelo (carga inmediata) ----------

async function init() {
  await Promise.all([cargarDocumentos(), cargarContactos()]);
}

renderQueue();
init();
