/* =========================================================================
   CATÁLOGO PARA CLIENTES — lógica de la página pública
   ---------------------------------------------------------------------
   · SOLO LECTURA: no hay manera de editar, borrar ni agregar nada.
   · Lee el archivo datos.json (generado con la herramienta del dueño).
   · Mismo formato de tarjetas que el catálogo, pero SIN precios y SIN stock.
   · Cada producto se puede pedir por WhatsApp al número del dueño.
   ========================================================================= */
(function () {
'use strict';

const WA_NUMERO = '59161102060';   // Bolivia +591 61102060

/* -------------------------------------------------------------------------
   1. UTILIDADES
   ------------------------------------------------------------------------- */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function norm(s) { return String(s == null ? '' : s).toUpperCase().trim(); }

/* Quita acentos y signos para que "PIEDRA" encuentre "Ají picante". */
function limpio(s) {
  return norm(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ').trim();
}

function toast(msg, tipo) {
  const wrap = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (tipo ? ' ' + tipo : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, tipo === 'err' ? 6000 : 3400);
}

/* Enlace de WhatsApp directo con mensaje armado. */
function waLink(texto) {
  return 'https://wa.me/' + WA_NUMERO + '?text=' + encodeURIComponent(texto);
}
function mensajeProducto(p) {
  let txt = 'Hola, quiero pedir este producto del catálogo:\n\n';
  if (p.codigo)      txt += '*Código:* ' + p.codigo + '\n';
  if (p.nombre)      txt += '*Producto:* ' + p.nombre + '\n';
  if (p.marca)       txt += '*Marca:* ' + p.marca + '\n';
  return txt;
}

/* -------------------------------------------------------------------------
   2. ESTADO EN MEMORIA
   ------------------------------------------------------------------------- */
const state = {
  productos: [],
  porId: new Map(),
  marcas: [],
  categorias: [],
  vista: [],
  modalId: null,
  galIdx: 0,
  tema: 'oscuro',
  cargando: true
};

/* -------------------------------------------------------------------------
   3. BÚSQUEDA (todas las palabras deben aparecer, como en la app original)
   ------------------------------------------------------------------------- */
function coincide(p, texto) {
  const toks = limpio(texto).split(/\s+/).filter(Boolean);
  if (!toks.length) return true;
  if (p._hw === undefined || p._hwV !== texto) {
    p._hw = limpio([p.nombre, p.marca, p.codigo, p.codigoBarras, p.categoria, p.caracteristicas].join(' '));
    p._hwV = texto;
  }
  return toks.every(t => p._hw.indexOf(t) !== -1);
}

function aplicarFiltros() {
  const texto = $('#search').value;
  const marca = $('#selMarca').value;
  const orden = $('#selOrden').value;

  let lista = state.productos.filter((p) => {
    if (marca && norm(p.marca) !== marca) return false;
    if (texto && !coincide(p, texto)) return false;
    return true;
  });

  const col = (a, b) => String(a || '').localeCompare(String(b || ''), 'es', { numeric: true });
  const cmp = {
    'nombre':      (a, b) => col(a.nombre, b.nombre),
    'nombre-desc': (a, b) => col(b.nombre, a.nombre),
    'codigo':      (a, b) => col(a.codigo, b.codigo),
    'categoria':   (a, b) => col(a.categoria, b.categoria) || col(a.nombre, b.nombre)
  }[orden] || ((a, b) => col(a.nombre, b.nombre));

  lista.sort(cmp);
  state.vista = lista;
}

/* -------------------------------------------------------------------------
   4. PINTADO DE TARJETAS
   ------------------------------------------------------------------------- */
function pintarTarjetas() {
  const grid = $('#grid');
  const lista = state.vista;
  const vacio = !lista.length;

  if (state.productos.length === 0) {
    // Aún no hay datos: lo decimos sin barra de subir backup (solo lectura).
    $('#empty').hidden = true;
    grid.innerHTML = '';
    return;
  }

  $('#empty').hidden = !vacio;
  $('#emptyTitle').textContent = vacio ? 'No hay productos que coincidan' : '';
  $('#emptyMsg').textContent = vacio ? 'Prueba con otra palabra o quita los filtros.' : '';

  if (vacio) { grid.innerHTML = ''; return; }

  grid.innerHTML = lista.map((p) => {
    const n = (p.fotos && p.fotos.length) || 0;
    return `
      <div class="card" data-id="${escapeHtml(p.id)}" tabindex="0">
        <div class="card-img">
          ${n ? `<img src="${escapeHtml(p.fotos[0])}" alt="${escapeHtml(p.nombre)}" decoding="async">`
              : `<span class="ph">🖼️</span>`}
          ${n > 1 ? `<span class="nphotos">📷 ${n}</span>` : ''}
        </div>
        <div class="card-body">
          <span class="card-code">${escapeHtml(p.codigo || 'S/C')}</span>
          <span class="card-name">${escapeHtml(p.nombre || 'Sin descripción')}</span>
          <span class="card-brand">${escapeHtml(p.marca || 'Sin marca')}</span>
          <div class="card-foot">
            <button class="card-wa" type="button" data-wa="${escapeHtml(p.id)}">💬 Pedir por WhatsApp</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function pintarMarcas() {
  const sel = $('#selMarca');
  const antes = sel.value;
  sel.innerHTML = '<option value="">Todas</option>' +
    state.marcas.map(m => `<option value="${escapeHtml(m.nombre)}">${escapeHtml(m.nombre)} (${m.n})</option>`).join('');
  if (state.marcas.some(m => m.nombre === antes)) sel.value = antes;
}

function render() {
  aplicarFiltros();
  pintarMarcas();
  pintarTarjetas();
}

/* -------------------------------------------------------------------------
   5. FICHA DEL PRODUCTO (modal) — SIN precios ni stocks
   ------------------------------------------------------------------------- */
function fila(label, valor) {
  return `<div class="detail-row">
      <span class="detail-label">${label}</span>
      <span class="detail-value">${valor}</span>
    </div>`;
}

function abrirFicha(id) {
  const p = state.porId.get(id);
  if (!p) return;
  state.modalId = id;
  state.galIdx = 0;

  $('#mdCodigo').textContent = p.codigo || 'SIN CÓDIGO';
  $('#mdTitle').textContent = p.nombre || 'Sin descripción';

  const tags = [];
  if (p.marca)     tags.push('🏷️ ' + escapeHtml(p.marca));
  if (p.categoria) tags.push('🗂️ ' + escapeHtml(p.categoria));
  const nf = (p.fotos && p.fotos.length) || 0;
  if (nf) tags.push('📷 ' + nf + (nf > 1 ? ' fotos' : ' foto'));
  $('#mdTags').innerHTML = tags.map(t => `<span class="tag">${t}</span>`).join('');

  const filas = [];
  filas.push(fila('Código', escapeHtml(p.codigo || '-')));
  filas.push(fila('Cód. de barras', escapeHtml(p.codigoBarras || '-')));
  filas.push(fila('Descripción', escapeHtml(p.nombre || '-')));
  filas.push(fila('Marca', escapeHtml(p.marca || '-')));
  filas.push(fila('Categoría', escapeHtml(p.categoria || '-')));
  // OJO: NO se muestran precio ni stock en la página de clientes.
  $('#mdGrid').innerHTML = filas.join('');

  const lineasCarac = String(p.caracteristicas || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  $('#mdCaracBlock').hidden = lineasCarac.length === 0;
  $('#mdCarac').innerHTML = lineasCarac
    .map(l => `<p>${escapeHtml(l)}</p>`)
    .join('');

  // Fotos
  const gal = document.querySelector('.gal');
  const track = $('#galTrack');
  const fotos = (p.fotos && p.fotos.length) ? p.fotos : [];
  if (fotos.length) {
    track.innerHTML = fotos.map(src => `<img src="${src}" alt="${escapeHtml(p.nombre)}" decoding="async">`).join('');
    gal.classList.add('has');
    gal.style.display = '';
  } else {
    track.innerHTML = '<span class="ph">🖼️</span>';
    gal.classList.remove('has');
  }
  actualizarGaleria();

  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function actualizarGaleria() {
  const track = $('#galTrack');
  const gal = document.querySelector('.gal');
  const hijos = track.children;
  const n = hijos.length;
  if (!n) return;
  const idx = Math.max(0, Math.min(state.galIdx, n - 1));
  track.scrollTo({ left: idx * track.clientWidth, behavior: 'smooth' });
  $('#galCounter').textContent = n > 1 ? `${idx + 1} / ${n}` : '';
  $('#galDots').innerHTML = n > 1
    ? Array.from({ length: n }, (_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')
    : '';
  $('#galPrev').style.visibility = (n > 1 && idx > 0) ? 'visible' : 'hidden';
  $('#galNext').style.visibility = (n > 1 && idx < n - 1) ? 'visible' : 'hidden';
}

function cerrarFicha() {
  $('#modal').hidden = true;
  state.modalId = null;
  document.body.style.overflow = '';
  $('#galTrack').innerHTML = '';
}

/* -------------------------------------------------------------------------
   6. CARGA DE DATOS (datos.json, generado con la herramienta del dueño)
   ------------------------------------------------------------------------- */
function setProgreso(pct, txt) {
  const bar = $('#progress');
  bar.hidden = false;
  $('#progressBar').style.width = Math.max(0, Math.min(100, pct)) + '%';
  $('#progressPct').textContent = Math.round(pct) + '%';
  if (txt) $('#progressTxt').textContent = txt;
}
function finProgreso() {
  $('#progress').hidden = true;
  $('#progressBar').style.width = '0%';
}

function normalizarLista(crudo) {
  const fila = Array.isArray(crudo) ? crudo : (crudo && crudo.productos);
  if (!Array.isArray(fila)) return [];
  const limpiar = s => String(s == null ? '' : s).trim();
  return fila
    .filter(Boolean)
    .map((raw, i) => {
      const fotos = Array.isArray(raw.fotos)
        ? raw.fotos.filter(x => typeof x === 'string' && x)
        : [];
      return {
        id: raw.id ? String(raw.id) : 'p_' + i + '_' + Date.now().toString(36),
        codigo:       limpiar(raw.codigo),
        codigoBarras: limpiar(raw.codigoBarras),
        nombre:       limpiar(raw.nombre),
        marca:        limpiar(raw.marca),
        categoria:    limpiar(raw.categoria),
        caracteristicas: String(raw.caracteristicas || ''),
        fotos: fotos.slice(0, 3)
      };
    });
}

async function cargarDatos() {
  state.cargando = true;
  setProgreso(8, 'Descargando el catálogo…');
  try {
    const resp = await fetch('datos.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const crudo = await resp.json();
    setProgreso(45, 'Preparando productos…');
    await new Promise(r => setTimeout(r, 30));

    state.productos = normalizarLista(crudo);
    state.porId = new Map(state.productos.map(p => [p.id, p]));

    const marcas = new Map(), cats = new Map();
    state.productos.forEach(p => {
      const m = String(p.marca || '').trim();
      if (m) marcas.set(m, (marcas.get(m) || 0) + 1);
      const c = String(p.categoria || '').trim();
      if (c) cats.set(c, (cats.get(c) || 0) + 1);
    });
    state.marcas = Array.from(marcas, ([nombre, n]) => ({ nombre, n }))
      .sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'));
    state.categorias = Array.from(cats, ([nombre]) => nombre);

    $('#filters').hidden = state.productos.length === 0;
    $('#footInfo').textContent = state.productos.length
      ? `${state.productos.length.toLocaleString('es-BO')} productos`
      : 'Catálogo para clientes';
    render();
    finProgreso();

    if (!state.productos.length) toast('El catálogo está vacío todavía.', 'err');
  } catch (err) {
    finProgreso();
    console.error(err);
    $('#grid').innerHTML = '';
    $('#empty').hidden = false;
    $('#emptyTitle').textContent = 'No se pudo cargar el catálogo';
    $('#emptyMsg').textContent = 'Revisa que el archivo datos.json esté junto a esta página.';
  }
  state.cargando = false;
}

/* -------------------------------------------------------------------------
   7. TEMA claro / oscuro (guardado en este dispositivo)
   ------------------------------------------------------------------------- */
function aplicarTema(t, guardar) {
  state.tema = (t === 'claro') ? 'claro' : 'oscuro';
  document.documentElement.setAttribute('data-tema', state.tema);
  $('#btnTheme').textContent = state.tema === 'claro' ? '☀️' : '🌙';
  if (guardar) {
    try { localStorage.setItem('catalogo_clientes_tema', state.tema); } catch (e) {}
  }
}

/* -------------------------------------------------------------------------
   8. SUGERENCIAS DEL BUSCADOR
   ------------------------------------------------------------------------- */
let sugTimer = null;
function mostrarSugerencias() {
  const texto = $('#search').value.trim();
  const box = $('#suggest');
  if (!texto || texto.length < 2 || state.productos.length === 0) { box.hidden = true; return; }

  const t = norm(texto);
  const exactos = state.productos.filter(p => norm(p.codigo) === t || norm(p.codigoBarras) === t).slice(0, 6);
  const otros = state.productos.filter(p => coincide(p, texto) && !exactos.includes(p)).slice(0, 10 - exactos.length);
  const lista = exactos.concat(otros);

  if (!lista.length) { box.hidden = true; return; }

  box.innerHTML = lista.map(p => `
    <button type="button" data-id="${escapeHtml(p.id)}">
      <span class="sg-code">${escapeHtml(p.codigo || 'S/C')}</span>
      <span class="sg-name">${escapeHtml(p.nombre || 'Sin descripción')}</span>
      <span class="sg-meta">${escapeHtml(p.marca || '')}</span>
    </button>`).join('');
  box.hidden = false;
}
function ocultarSugerencias() {
  clearTimeout(sugTimer);
  sugTimer = setTimeout(() => { $('#suggest').hidden = true; }, 140);
}

/* -------------------------------------------------------------------------
   9. EVENTOS
   ------------------------------------------------------------------------- */
function conectarEventos() {
  // --- Buscador ---
  let debounce;
  $('#search').addEventListener('input', () => {
    const v = $('#search').value;
    $('#btnClear').hidden = !v;
    clearTimeout(debounce);
    debounce = setTimeout(() => { render(); }, 110);
    mostrarSugerencias();
  });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { $('#suggest').hidden = true; render(); }
    if (e.key === 'Escape') { $('#search').value = ''; $('#btnClear').hidden = true; render(); $('#suggest').hidden = true; }
  });
  $('#btnClear').addEventListener('click', () => {
    $('#search').value = ''; $('#btnClear').hidden = true; render();
    $('#search').focus();
  });
  $('#suggest').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) { $('#suggest').hidden = true; abrirFicha(b.dataset.id); }
  });
  $('#suggest').addEventListener('mouseover', () => clearTimeout(sugTimer));
  $('#suggest').addEventListener('mouseout', ocultarSugerencias);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchbar')) $('#suggest').hidden = true;
  });

  // --- Filtros ---
  ['#selMarca', '#selOrden'].forEach(sel =>
    $(sel).addEventListener('change', render));

  // --- WhatsApp desde el "pedir todo" de arriba ---
  $('#btnPedirTodo').addEventListener('click', () => {
    window.open(waLink('Hola, quiero hacer un pedido del catálogo.'), '_blank');
  });

  // --- Rejilla: el botón verde pide por WhatsApp, el resto abre la ficha ---
  $('#grid').addEventListener('click', (e) => {
    const wa = e.target.closest('[data-wa]');
    if (wa) {
      const p = state.porId.get(wa.dataset.wa);
      if (p) window.open(waLink(mensajeProducto(p)), '_blank');
      return;
    }
    const c = e.target.closest('.card');
    if (c) abrirFicha(c.dataset.id);
  });
  $('#grid').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('card')) {
      abrirFicha(e.target.dataset.id);
    }
  });

  // --- Ficha ---
  $('#modal').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) cerrarFicha();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').hidden) cerrarFicha();
    if ($('#modal').hidden) return;
    if (e.key === 'ArrowLeft')  { state.galIdx = Math.max(0, state.galIdx - 1); actualizarGaleria(); }
    if (e.key === 'ArrowRight') { state.galIdx += 1; actualizarGaleria(); }
  });
  $('#galPrev').addEventListener('click', () => { state.galIdx = Math.max(0, state.galIdx - 1); actualizarGaleria(); });
  $('#galNext').addEventListener('click', () => { state.galIdx += 1; actualizarGaleria(); });
  $('#galTrack').addEventListener('scroll', () => {
    const t = $('#galTrack');
    if (!t.clientWidth) return;
    const i = Math.round(t.scrollLeft / t.clientWidth);
    if (i !== state.galIdx) { state.galIdx = i; actualizarGaleria(); }
  });
  window.addEventListener('resize', () => { if (!$('#modal').hidden) actualizarGaleria(); });

  // WhatsApp desde la ficha
  $('#mdWa').addEventListener('click', () => {
    const p = state.porId.get(state.modalId);
    if (p) window.open(waLink(mensajeProducto(p)), '_blank');
  });

  // --- Tema ---
  $('#btnTheme').addEventListener('click', () => aplicarTema(state.tema === 'claro' ? 'oscuro' : 'claro', true));

  // --- Atajo "/" para buscar ---
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('#search') && $('#modal').hidden) {
      e.preventDefault(); $('#search').focus();
    }
  });
}

/* -------------------------------------------------------------------------
   10. ARRANQUE
   ------------------------------------------------------------------------- */
async function iniciar() {
  conectarEventos();
  try {
    const t = localStorage.getItem('catalogo_clientes_tema');
    aplicarTema(t === 'claro' ? 'claro' : 'oscuro', false);
  } catch (e) {}
  await cargarDatos();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}

})();