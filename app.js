/* =========================================================================
   CATÁLOGO — lógica de la app
   ---------------------------------------------------------------------
   · Guarda productos y fotos en IndexedDB (aguanta archivos de 30 MB+).
   · Importa los backups de la app original:
       - stockferre_backup_*.json   (productos + categorías + imágenes)
       - stockferre_fotos_*.json    (solo fotos, se reenganchan por código)
   · Buscador con palabras, filtros por categoría / marca / stock y orden.
   · Ficha del producto con la misma información que ve el modo Invitado.
   ========================================================================= */
(function () {
'use strict';

/* -------------------------------------------------------------------------
   1. BASE DE DATOS (IndexedDB)
   Almacena: productos, fotos y unos pocos metadatos.
   ------------------------------------------------------------------------- */
const DB_NAME = 'catalogo_tienda_v1';
const DB_VERSION = 1;
let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('productos')) db.createObjectStore('productos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('fotos'))     db.createObjectStore('fotos',     { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta'))      db.createObjectStore('meta',      { keyPath: 'k' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(stores, mode) {
  return _db.transaction(stores, mode);
}
function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción cancelada'));
  });
}

const Store = {
  getAllProductos: () => reqP(tx(['productos'], 'readonly').objectStore('productos').getAll()),
  clearProductos: async function () {
    const t = tx(['productos'], 'readwrite');
    t.objectStore('productos').clear();
    return txDone(t);
  },
  putProductos: function (list) {
    const t = tx(['productos'], 'readwrite');
    const s = t.objectStore('productos');
    list.forEach(p => s.put(p));
    return txDone(t);
  },
  putFoto: function (rec) {
    const t = tx(['fotos'], 'readwrite');
    t.objectStore('fotos').put(rec);
    return txDone(t);
  },
  clearFotos: async function () {
    const t = tx(['fotos'], 'readwrite');
    t.objectStore('fotos').clear();
    return txDone(t);
  },
  getFoto: (id) => reqP(tx(['fotos'], 'readonly').objectStore('fotos').get(id)),
  getAllFotos: () => reqP(tx(['fotos'], 'readonly').objectStore('fotos').getAll()),
  getMeta: (k, def) => reqP(tx(['meta'], 'readonly').objectStore('meta').get(k))
            .then(r => (r && r.v !== undefined) ? r.v : def),
  setMeta: function (k, v) {
    const t = tx(['meta'], 'readwrite');
    t.objectStore('meta').put({ k: k, v: v });
    return txDone(t);
  }
};

/* -------------------------------------------------------------------------
   2. UTILIDADES
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
function fmtMoney(n) { return 'Bs ' + (Number(n) || 0).toFixed(2); }
function toNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function todayISO() { return new Date().toISOString(); }

/* Quita acentos y signos para que "ACEITE" encuentre "aceite" y "CINTA" también. */
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* -------------------------------------------------------------------------
   3. ESTADO EN MEMORIA
   Solo los datos de texto: las fotos se leen de IndexedDB al mostrarlas,
   así la app no se traga la memoria con archivos de 30 MB de imágenes.
   ------------------------------------------------------------------------- */
const state = {
  productos: [],              // objetos producto
  porId: new Map(),           // id -> producto
  fotosN: new Map(),          // id -> cantidad de fotos
  categorias: [],             // lista de categorías con conteo
  marcas: [],                 // lista de marcas
  vista: [],                  // productos ya filtrados y ordenados
  modalId: null,              // producto abierto en la ficha
  galIdx: 0,
  catSel: '',                 // categoría elegida en las etiquetas
  observando: null,           // IntersectionObserver de imágenes
  pendingImgs: new Set()      // ids ya pedidos, para no repetirlos
};

/* -------------------------------------------------------------------------
   4. BÚSQUEDA  (igual que la app original: todas las palabras deben aparecer)
   ------------------------------------------------------------------------- */
function coincide(p, texto) {
  const toks = limpio(texto).split(/\s+/).filter(Boolean);
  if (!toks.length) return true;
  // Solo se arma la bolsa de palabras si hay algo que buscar.
  if (p._hw === undefined || p._hwV !== texto) {
    p._hw = limpio([p.nombre, p.marca, p.codigo, p.codigoBarras, p.categoria, p.caracteristicas].join(' '));
    p._hwV = texto;
  }
  return toks.every(t => p._hw.indexOf(t) !== -1);
}

function aplicarFiltros() {
  const texto = $('#search').value;
  const cat = state.catSel || '';
  const marca = $('#selMarca').value;
  const disp = $('#selStock').value;
  const orden = $('#selOrden').value;

  let lista = state.productos.filter((p) => {
    if (cat && norm(p.categoria) !== cat) return false;
    if (marca && norm(p.marca) !== marca) return false;
    if (disp === 'con' && !(p.stock > 0)) return false;
    if (disp === 'sin' && p.stock > 0) return false;
    if (disp === 'bajo' && !(p.stock <= 0 || (p.stockMin > 0 && p.stock <= p.stockMin))) return false;
    if (disp === 'foto' && !state.fotosN.get(p.id)) return false;
    if (texto && !coincide(p, texto)) return false;
    return true;
  });

  const col = (a, b) => String(a || '').localeCompare(String(b || ''), 'es', { numeric: true });
  const cmp = {
    'nombre':      (a, b) => col(a.nombre, b.nombre),
    'nombre-desc': (a, b) => col(b.nombre, a.nombre),
    'precio':      (a, b) => a.precioVenta - b.precioVenta,
    'precio-desc': (a, b) => b.precioVenta - a.precioVenta,
    'stock':       (a, b) => b.stock - a.stock,
    'codigo':      (a, b) => col(a.codigo, b.codigo),
    'categoria':   (a, b) => col(a.categoria, b.categoria) || col(a.nombre, b.nombre)
  }[orden] || ((a, b) => col(a.nombre, b.nombre));

  lista.sort(cmp);
  state.vista = lista;
}

/* -------------------------------------------------------------------------
   5. PINTADO
   ------------------------------------------------------------------------- */
function claseStock(p) {
  if (p.stock > 0) {
    return (p.stockMin > 0 && p.stock <= p.stockMin) ? 'warn' : 'ok';
  }
  return 'out';
}
function textoStock(p) {
  if (p.stock > 0) return `${p.stock} en stock`;
  return 'Agotado';
}

function pintarTarjetas() {
  const grid = $('#grid');
  const lista = state.vista;
  const vacio = !lista.length;

  $('#empty').hidden = !vacio && state.productos.length > 0;
  if (state.productos.length === 0) {
    $('#empty').hidden = false;
    $('#emptyTitle').textContent = 'Aún no hay productos en el catálogo';
  } else {
    $('#emptyTitle').textContent = 'No hay productos que coincidan';
    $('#emptyMsg').textContent = 'Prueba con otra palabra, quita los filtros o cambia la categoría seleccionada.';
    $('#btnImport2').hidden = true;
  }

  if (vacio) { grid.innerHTML = ''; return; }

  grid.innerHTML = lista.map((p, i) => {
    const n = state.fotosN.get(p.id) || 0;
    const cod = escapeHtml(p.codigo || 'S/C');
    return `
      <button class="card" data-id="${escapeHtml(p.id)}" type="button">
        <div class="card-img">
          ${n ? `<img data-lazy="${escapeHtml(p.id)}" alt="${escapeHtml(p.nombre)}" decoding="async">`
               : `<span class="ph">🖼️</span>`}
          ${n > 1 ? `<span class="nphotos">📷 ${n}</span>` : ''}
        </div>
        <div class="card-body">
          <span class="card-code">${cod}</span>
          <span class="card-name">${escapeHtml(p.nombre || 'Sin descripción')}</span>
          <span class="card-brand">${escapeHtml(p.marca || 'Sin marca')}</span>
          <div class="card-foot">
            <span class="price"><small>Precio</small>${fmtMoney(p.precioVenta)}</span>
            <span class="stock-pill ${claseStock(p)}">${textoStock(p)}</span>
          </div>
        </div>
      </button>`;
  }).join('');

  observarLazies();
}

/* Carga la foto solo cuando la tarjeta se acerca a la pantalla. */
function observarLazies() {
  if (state.observando) state.observando.disconnect();
  const nodes = $$('#grid img[data-lazy]');
  if (!nodes.length) return;
  if (typeof IntersectionObserver === 'undefined') {
    nodes.forEach(n => cargarFoto(n));
    return;
  }
  state.observando = new IntersectionObserver((ents) => {
    ents.forEach(e => {
      if (e.isIntersecting) cargarFoto(e.target);
    });
  }, { rootMargin: '300px 0px' });
  nodes.forEach(n => state.observando.observe(n));
}

async function cargarFoto(img) {
  const id = img.getAttribute('data-lazy');
  if (!id || state.pendingImgs.has(id)) return;
  state.pendingImgs.add(id);
  const src = await primeraFoto(id);
  if (src) { img.src = src; img.removeAttribute('data-lazy'); }
  else { img.outerHTML = '<span class="ph">🖼️</span>'; }
  state.pendingImgs.delete(id);
}

const cacheFoto = new Map(); // id -> src (solo las que ya seattleshoween)

async function primeraFoto(id) {
  if (cacheFoto.has(id)) return cacheFoto.get(id);
  const rec = await Store.getFoto(id);
  const src = (rec && (rec.imgs[0] || rec.urls[0])) || '';
  cacheFoto.set(id, src);
  return src;
}

async function todasLasFotos(id) {
  const rec = await Store.getFoto(id);
  if (!rec) return [];
  return rec.imgs.length ? rec.imgs : rec.urls;
}

function pintarResumen() {
  const conFoto = state.productos.filter(p => state.fotosN.get(p.id)).length;
  const conStock = state.productos.filter(p => p.stock > 0).length;
  $('#stTotal').textContent = state.productos.length;
  $('#stCategorias').textContent = state.categorias.length;
  $('#stMarcas').textContent = state.marcas.length;
  $('#stFotos').textContent = conFoto;
  $('#stStock').textContent = conStock;
  $('#stats').hidden = state.productos.length === 0;
  $('#filters').hidden = state.productos.length === 0;
  $('#btnExport').disabled = state.productos.length === 0;
}

function pintarCategorias() {
  const cont = state.categorias.filter(c => c.n > 0);
  const sel = state.catSel;
  const chip = (cat, texto, n) =>
    `<button class="chip${cat === sel ? ' active' : ''}" data-cat="${escapeHtml(cat)}">${escapeHtml(texto)} <b>${n}</b></button>`;
  const html = [chip('', '📦 Todas', state.productos.length)]
    .concat(cont.map(c => chip(c.nombre, c.nombre, c.n)))
    .join('');
  const box = $('#catChips');
  box.innerHTML = html;
  box.hidden = cont.length === 0;
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
  pintarResumen();
  pintarCategorias();
  pintarMarcas();
  pintarTarjetas();
  const n = state.vista.length;
  $('#count').textContent = n === 1 ? '1 producto' : n + ' productos';
}

/* -------------------------------------------------------------------------
   6. FICHA DEL PRODUCTO (modal)
   ------------------------------------------------------------------------- */
function fila(label, valor, esPrecio) {
  return `<div class="detail-row${esPrecio ? ' is-price' : ''}">
      <span class="detail-label">${label}</span>
      <span class="detail-value">${valor}</span>
    </div>`;
}

async function abrirFicha(id) {
  const p = state.porId.get(id);
  if (!p) return;
  state.modalId = id;
  state.galIdx = 0;

  $('#mdCodigo').textContent = p.codigo || 'SIN CÓDIGO';
  $('#mdTitle').textContent = p.nombre || 'Sin descripción';

  const pill = $('#mdStockPill');
  pill.className = 'stock-pill ' + claseStock(p);
  pill.textContent = textoStock(p);

  const tags = [];
  if (p.marca)     tags.push('🏷️ ' + escapeHtml(p.marca));
  if (p.categoria) tags.push('🗂️ ' + escapeHtml(p.categoria));
  if (state.fotosN.get(p.id)) tags.push('📷 ' + state.fotosN.get(p.id) + (state.fotosN.get(p.id) > 1 ? ' fotos' : ' foto'));
  $('#mdTags').innerHTML = tags.map(t => `<span class="tag">${t}</span>`).join('');

  // Mismos campos que muestra la app original en modo Invitado.
  const filas = [];
  filas.push(fila('Código', escapeHtml(p.codigo || '-')));
  filas.push(fila('Cód. de barras', escapeHtml(p.codigoBarras || '-')));
  filas.push(fila('Descripción', escapeHtml(p.nombre || '-')));
  filas.push(fila('Marca', escapeHtml(p.marca || '-')));
  filas.push(fila('Categoría', escapeHtml(p.categoria || '-')));
  filas.push(fila('Precio de venta', fmtMoney(p.precioVenta), true));
  filas.push(fila('Stock', `${p.stock} und.`));
  filas.push(fila('Stock mín.', String(p.stockMin || 0)));
  $('#mdGrid').innerHTML = filas.join('');

  const carac = String(p.caracteristicas || '').trim();
  $('#mdCaracBlock').hidden = !carac;
  $('#mdCarac').textContent = carac;

  // Fotos
  const gal = document.querySelector('.gal');
  const track = $('#galTrack');
  const fotos = await todasLasFotos(id);
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
  const track = $('#galTrack');
  track.innerHTML = '';
  cacheFoto.clear();
}

/* -------------------------------------------------------------------------
   7. IMPORTAR BACKUP
   Acepta:
     · stockferre_backup_*.json → { productos, categorias, imagenes, imgUrl }
     · stockferre_fotos_*.json  → { _tipo, imgs_manual, imgs_electrico }
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

/* -------------------------------------------------------------------------
   FUSIONAR PRODUCTOS
   Los backups de la app original vienen troceados: unos traen fotos y otros
   traen categorías. Aquí se juntan por CÓDIGO: si el producto ya existe solo se
   rellenan los datos que faltaban, nunca se pisa un dato que ya se tenía.
   ------------------------------------------------------------------------- */
const CAMPOS_TEXTO = ['codigo', 'codigoBarras', 'nombre', 'marca', 'categoria', 'caracteristicas'];
const CAMPOS_NUMERO = ['precioCompra', 'precioMarca', 'precioVenta', 'stock', 'stockMin'];

function fusionar(existente, entrante) {
  let cambios = 0;
  CAMPOS_TEXTO.forEach(k => {
    if (!String(existente[k] || '').trim() && String(entrante[k] || '').trim()) {
      existente[k] = entrante[k];
      cambios++;
    }
  });
  CAMPOS_NUMERO.forEach(k => {
    if (!(Number(existente[k]) > 0) && Number(entrante[k]) > 0) {
      existente[k] = entrante[k];
      cambios++;
    }
  });
  if (!existente.nombre && entrante.nombre) cambios++;
  return cambios;
}

/* Convierte cualquier forma de foto que traiga el backup a {data:[], url:[]}. */
function normalizarFotos(valor) {
  if (!valor) return null;
  let data = [], url = [], codigo = '', barras = '';

  if (Array.isArray(valor)) {
    data = valor.filter(x => typeof x === 'string' && x);
  } else if (valor && typeof valor === 'object') {
    const d = (valor.data !== undefined) ? valor.data : valor.d;
    const u = (valor.url !== undefined) ? valor.url : valor.u;
    data = Array.isArray(d) ? d.filter(x => typeof x === 'string' && x) : (typeof d === 'string' && d ? [d] : []);
    url  = Array.isArray(u) ? u.filter(x => typeof x === 'string' && x) : (typeof u === 'string' && u ? [u] : []);
    codigo = valor.codigo ? String(valor.codigo) : '';
    barras = valor.codigoBarras ? String(valor.codigoBarras) : '';
  } else if (typeof valor === 'string' && valor) {
    data = [valor];
  }
  if (!data.length && !url.length) return null;
  while (url.length < data.length) url.push('');
  return { data, url, codigo, barras };
}

function leerArchivo(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => {
      try { resolve(JSON.parse(e.target.result)); }
      catch (err) { reject(new Error('El archivo no es un JSON válido')); }
    };
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsText(file, 'UTF-8');
  });
}

/* Un backup con fotos pesa decenas de MB. En un celular con poca memoria
   RAM el navegador puede quedarse sin aire al leerlo, así que se avisa antes
   de intentar abrirlo en vez de cerrar la app de golpe. */
const MB = 1024 * 1024;
const PESO_LIMITE = 120 * MB;

function pesoLegible(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes >= MB) return (bytes / MB).toFixed(1).replace('.0', '') + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

async function importar(file) {
  let datos;
  setProgreso(3, 'Leyendo el archivo…');
  await sleep(0);

  const peso = Number(file.size) || 0;
  if (peso > PESO_LIMITE) {
    finProgreso();
    return toast('Ese archivo pesa ' + pesoLegible(peso) + ' y es demasiado grande para abrirlo aquí. Sube primero el backup de productos y después el archivo de fotos por separado.', 'err');
  }
  if (peso > 40 * MB && !confirm(
    'El archivo ' + file.name + ' pesa ' + pesoLegible(peso) + '.\n\n' +
    'En el celular puede tardar, y el navegador puede cerrar la app si le\n' +
    'queda poca memoria.\n\n' +
    '¿Continuar?')) {
    finProgreso();
    return;
  }

  try {
    datos = await leerArchivo(file);
  } catch (err) {
    finProgreso();
    return toast(err.message, 'err');
  }

  const crudo = Array.isArray(datos) ? { productos: datos } : (datos || {});

  // ---- Recolectar fotos de cualquier formato ----
  const fotos = new Map(); // id -> {data, url, codigo, barras}
  const sinId = [];       // fotos que solo traen código (archivo de fotos)

  const meter = (mapa, id) => {
    const f = normalizarFotos(mapa[id]);
    if (!f) return;
    if (id) fotos.set(id, f);
    if (f.codigo || f.barras) sinId.push(f);
  };

  if (crudo.imagenes && typeof crudo.imagenes === 'object') {
    Object.keys(crudo.imagenes).forEach(id => meter(crudo.imagenes, id));
  }
  ['imgs_manual', 'imgs_electrico'].forEach(k => {
    if (crudo[k] && typeof crudo[k] === 'object') {
      Object.keys(crudo[k]).forEach(id => meter(crudo[k], id));
    }
  });
  if (crudo.imgUrl && typeof crudo.imgUrl === 'object') {
    Object.keys(crudo.imgUrl).forEach(id => {
      const base = fotos.get(id) || { data: [], url: [], codigo: '', barras: '' };
      const n = normalizarFotos(crudo.imgUrl[id]);
      if (!n) return;
      // imgUrl trae DIRECCIONES, no imágenes embebidas: van en url,
      // no en data (si se guardaran en data, la foto no se vería).
      const aporte = n.data.length ? n.data : n.url;
      for (let i = 0; i < aporte.length; i++) {
        if (!base.url[i] && aporte[i]) base.url[i] = aporte[i];
      }
      while (base.url.length < base.data.length) base.url.push('');
      fotos.set(id, base);
    });
  }

  // ---- Productos ----
  let productos = Array.isArray(crudo.productos) ? crudo.productos : [];
  const esSoloFotos = !productos.length && fotos.size > 0;

  if (!productos.length && !esSoloFotos) {
    finProgreso();
    return toast('El archivo no tiene productos ni fotos.', 'err');  }

  // Normaliza y deduplica por código.
  const vistos = new Set();
  const limpios = [];
  for (const raw of productos) {
    if (!raw) continue;
    const cod = String(raw.codigo || '').trim();
    const clave = cod ? limpio(cod) : 'id:' + (raw.id || Math.random());
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    limpios.push({
      id:     raw.id ? String(raw.id) : 'p_' + limpios.length + '_' + Date.now().toString(36),
      codigo: cod,
      codigoBarras: String(raw.codigoBarras || '').trim(),
      nombre: String(raw.nombre || '').trim(),
      marca:  String(raw.marca  || '').trim(),
      categoria: String(raw.categoria || '').trim(),
      precioCompra: toNum(raw.precioCompra),
      precioMarca:  toNum(raw.precioMarca),
      precioVenta:  toNum(raw.precioVenta),
      stock:     Math.max(0, Math.round(toNum(raw.stock))),
      stockMin:  Math.max(0, Math.round(toNum(raw.stockMin))),
      caracteristicas: String(raw.caracteristicas || '')
    });
  }

  setProgreso(12, `Preparando ${limpios.length.toLocaleString('es-BO')} productos…`);
  await sleep(0);

  // ---- Fusionar con lo que YA está en el catálogo ----
  // Nada se borra: si el producto ya existe (por id, código o código de barras)
  // solo se le rellenan los datos que le faltaban. Así se pueden subir varios
  // backups de días distintos y quedarse con la información más completa.
  const porId = new Map(), porCodigo = new Map(), porBarras = new Map();
  const indexar = (p) => {
    porId.set(p.id, p);
    const c = limpio(p.codigo); if (c && !porCodigo.has(c)) porCodigo.set(c, p);
    const b = limpio(p.codigoBarras); if (b && !porBarras.has(b)) porBarras.set(b, p);
  };

  const existentes = await Store.getAllProductos();
  existentes.forEach(indexar);

  // id del backup -> id con el que queda guardado (el del catálogo)
  const idFinal = new Map();
  const aGuardar = [];
  let nuevos = 0, completados = 0;

  limpios.forEach(p => {
    const c = limpio(p.codigo), b = limpio(p.codigoBarras);
    const previo = porId.get(p.id) || (c && porCodigo.get(c)) || (b && porBarras.get(b)) || null;

    if (previo) {
      // Mismo producto: se conserva su id (para no perder sus fotos) y se
      // completan los campos vacíos con lo que trae este backup.
      if (fusionar(previo, p)) completados++;
      if (previo.id !== p.id) idFinal.set(p.id, previo.id);
      aGuardar.push(previo);
    } else {
      indexar(p);
      nuevos++;
      aGuardar.push(p);
    }
  });

  // ---- Escribir productos por tandas ----
  const LOTE = 400;
  for (let i = 0; i < aGuardar.length; i += LOTE) {
    await Store.putProductos(aGuardar.slice(i, i + LOTE));
    setProgreso(12 + Math.round(55 * Math.min(1, (i + LOTE) / aGuardar.length)),
      `Guardando productos ${Math.min(i + LOTE, aGuardar.length)} / ${aGuardar.length}…`);
    await sleep(0);
  }

  // ---- Escribir fotos (por tandas, con barra de progreso) ----
  // Las fotos van ligadas al producto por id. Si el id del backup es de otra
  // sesión, se traduce al id que tiene aquí (por id, código o código de barras).
  const totalFotos = fotos.size;
  let hechas = 0, enlazadas = 0;
  if (totalFotos) {
    setProgreso(70, `Guardando ${totalFotos} juegos de fotos…`);
    const lote = [];
    for (const [idCrudo, f] of fotos) {
      const id = idFinal.get(idCrudo) || idCrudo;
      const prop = porId.get(id);
      let destino = id;
      if (!prop) {
        const cod = limpio(f.codigo);
        const bar = limpio(f.barras);
        const hall = (cod && porCodigo.get(cod)) || (bar && porBarras.get(bar));
        if (hall) destino = hall.id;
      }
      if (porId.has(destino)) enlazadas++;
      lote.push({ id: destino, imgs: f.data.slice(0, 3), urls: f.url.slice(0, 3) });
      hechas++;
      if (lote.length >= 150) {
        await Promise.all(lote.map(r => Store.putFoto(r)));
        setProgreso(70 + Math.round(28 * hechas / totalFotos), `Guardando fotos ${hechas} / ${totalFotos}…`);
        lote.length = 0;
        await sleep(0);
      }
    }
    if (lote.length) await Promise.all(lote.map(r => Store.putFoto(r)));
  }

  // ---- Fotos del archivo de fotos que no traen id: enlazar por código ----
  if (sinId.length) {
    for (const f of sinId) {
      const p = (f.codigo && porCodigo.get(limpio(f.codigo))) || (f.barras && porBarras.get(limpio(f.barras)));
      if (!p) continue;
      const ya = await Store.getFoto(p.id);
      if (ya && ya.imgs && ya.imgs.length) continue;   // ya tiene foto: no se pisa
      await Store.putFoto({ id: p.id, imgs: f.data.slice(0, 3), urls: f.url.slice(0, 3) });
    }
  }

  setProgreso(99, 'Terminando…');

  // ---- Recargar desde la base de datos ----
  await cargarTodo();

  // Se guarda la lista de archivos importados: el pie lo muestra como
  // historial para que se sepa de dónde salió cada dato.
  const historial = (await Store.getMeta('historial', [])) || [];
  if (!historial.includes(file.name)) {
    historial.push(file.name);
    await Store.setMeta('historial', historial);
  }
  await Store.setMeta('ultimoBackup', {
    archivo: file.name,
    fecha: todayISO(),
    productos: state.productos.length,
    fotos: enlazadas
  });
  await Store.setMeta('tema', temaActual);

  finProgreso();
  await pintarPie();

  const conFoto = state.productos.filter(p => state.fotosN.get(p.id)).length;
  const num = (n) => n.toLocaleString('es-BO');

  if (esSoloFotos) {
    if (enlazadas) {
      toast(`Fotos cargadas: ${num(enlazadas)} productos ya tienen foto.`, 'ok');
    } else {
      toast('Las fotos se guardaron, pero NINGUNA se pudo asignar: este archivo de fotos es de una versión anterior del catálogo. Sube un backup de productos (stockferre_backup_*.json) del mismo día y después vuelve a subir este archivo de fotos.', 'err');
    }
    return;
  }

  const partes = [`Catálogo: ${num(state.productos.length)} productos`];
  if (nuevos) partes.push(`${num(nuevos)} nuevos`);
  if (completados) partes.push(`${num(completados)} completados con los datos que faltaban`);
  if (enlazadas) partes.push(`${num(enlazadas)} con foto`);
  toast(partes.join(' · '), 'ok');

  if (conFoto === 0) {
    setTimeout(() => toast('Este backup no traía imágenes. Sube además el archivo "Exportar fotos" (stockferre_fotos_*.json) para verlas.', 'err'), 900);
  } else if (!state.categorias.length) {
    setTimeout(() => toast('Este backup no trae categorías. Sube también un backup que sí las tenga y se completarán solas (los productos se unen por código).', 'err'), 900);
  }
}

/* -------------------------------------------------------------------------
   8. EXPORTAR (copia del catálogo, por si hay que pasarlo a otro equipo)
   ------------------------------------------------------------------------- */
async function exportar() {
  if (!state.productos.length) return;
  const btn = $('#btnExport');
  btn.disabled = true;
  setProgreso(5, 'Preparando la copia…');
  try {
    const fotos = await Store.getAllFotos();
    const imagenes = {}, imgUrl = {};
    fotos.forEach(f => {
      if (f.imgs && f.imgs.length) imagenes[f.id] = f.imgs;
      if (f.urls && f.urls.filter(Boolean).length) imgUrl[f.id] = f.urls;
    });
    const payload = {
      _tipo: 'catalogo_tienda',
      version: 1,
      fecha: todayISO(),
      productos: state.productos,
      categorias: state.categorias.map(c => c.nombre),
      imagenes: imagenes,
      imgUrl: imgUrl
    };
    setProgreso(60, 'Escribiendo el archivo…');
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `catalogo_${todayISO().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    finProgreso();
    toast('Copia del catálogo descargada.', 'ok');
  } catch (err) {
    finProgreso();
    toast('No se pudo exportar: ' + err.message, 'err');
  }
  btn.disabled = state.productos.length === 0;
}

/* -------------------------------------------------------------------------
   8b. VACIAR EL CATÁLOGO (para empezar de cero)
   ------------------------------------------------------------------------- */
async function vaciarCatalogo() {
  if (!state.productos.length) {
    return toast('El catálogo ya está vacío.', 'err');
  }
  const n = state.productos.length.toLocaleString('es-BO');
  if (!confirm(`Se van a borrar los ${n} productos y todas sus fotos de este equipo.\n\n` +
               `Esto NO borra los archivos .json de la app original.\n` +
               `Si no estás seguro, primero usa "Exportar" para guardar una copia.\n\n` +
               `¿Vaciar el catálogo?`)) return;

  const btn = $('#btnReset');
  btn.disabled = true;
  setProgreso(20, 'Borrando el catálogo…');
  try {
    await Store.clearProductos();
    await Store.clearFotos();
    await Store.setMeta('ultimoBackup', null);
    await Store.setMeta('historial', []);
    state.catSel = '';
    state.fotosN.clear();
    cacheFoto.clear();
    await cargarTodo();
    finProgreso();
    toast('Catálogo vacío. Ya puedes subir un backup desde cero.', 'ok');
  } catch (err) {
    finProgreso();
    toast('No se pudo vaciar: ' + err.message, 'err');
  }
  btn.disabled = false;
}

/* -------------------------------------------------------------------------
   9. ARRANQUE
   ------------------------------------------------------------------------- */
async function cargarTodo() {
  const productos = await Store.getAllProductos();
  state.productos = productos;
  state.porId = new Map(productos.map(p => [p.id, p]));

  // Fotos: solo guardamos la cantidad, no el contenido.
  const fotos = await Store.getAllFotos();
  state.fotosN = new Map();
  fotos.forEach(f => {
    const n = (f.imgs && f.imgs.length) ? f.imgs.length : ((f.urls && f.urls.length) || 0);
    if (n) state.fotosN.set(f.id, n);
  });

  // Categorías y marcas con conteo.
  const cats = new Map(), marcas = new Map();
  productos.forEach(p => {
    const c = String(p.categoria || '').trim();
    if (c) cats.set(c, (cats.get(c) || 0) + 1);
    const m = String(p.marca || '').trim();
    if (m) marcas.set(m, (marcas.get(m) || 0) + 1);
  });
  state.categorias = Array.from(cats, ([nombre, n]) => ({ nombre, n }))
    .sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'));
  state.marcas = Array.from(marcas, ([nombre, n]) => ({ nombre, n }))
    .sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'));

  cacheFoto.clear();
  state.metaUltimo = await Store.getMeta('ultimoBackup', null);
  state.historial = await Store.getMeta('historial', []);
  render();
  pintarPie();
}

function pintarPie() {
  const meta = state.metaUltimo;
  if (!state.productos.length) {
    $('#footInfo').textContent = 'Catálogo local · sin conexión';
    return;
  }
  let txt = `${state.productos.length.toLocaleString('es-BO')} productos guardados en este equipo`;
  if (meta && meta.archivo) {
    const d = new Date(meta.fecha);
    txt += ` · último backup: ${meta.archivo} (${d.toLocaleDateString('es-BO')})`;
  }
  const archivos = state.historial || [];
  if (archivos.length > 1) {
    txt += ` · datos de ${archivos.length} archivos`;
    $('#footInfo').title = 'Archivos importados:\n' + archivos.join('\n');
  } else {
    $('#footInfo').title = '';
  }
  $('#footInfo').textContent = txt;
}

/* ---------- Tema claro / oscuro ---------- */
let temaActual = 'oscuro';
async function aplicarTema(t) {
  temaActual = (t === 'claro') ? 'claro' : 'oscuro';
  document.documentElement.setAttribute('data-tema', temaActual);
  $('#btnTheme').textContent = temaActual === 'claro' ? '☀️' : '🌙';
  try { await Store.setMeta('tema', temaActual); } catch (e) { /* sin base de datos aún */ }
}

/* ---------- Sugerencias del buscador ---------- */
let sugTimer = null;
function mostrarSugerencias() {
  const texto = $('#search').value.trim();
  const box = $('#suggest');
  if (!texto || texto.length < 2 || state.productos.length === 0) { box.hidden = true; return; }

  // Coincidencia exacta de código / código de barras primero, como en la app.
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
   10. EVENTOS
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
  $('#catChips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    $$('#catChips .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    state.catSel = c.dataset.cat || '';
    render();
  });
  ['#selMarca', '#selStock', '#selOrden'].forEach(sel =>
    $(sel).addEventListener('change', render));

  // --- Rejilla ---
  $('#grid').addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (c) abrirFicha(c.dataset.id);
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
  $('#mdWa').addEventListener('click', () => {
    const p = state.porId.get(state.modalId);
    if (!p) return;
    const texto = `Hola, me interesa este producto del catálogo:\n\nCódigo: ${p.codigo}\n${p.nombre}\n${p.marca || ''}\nPrecio: ${fmtMoney(p.precioVenta)}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
  });

  // --- Importar / exportar / tema ---
  const pedir = () => $('#fileInput').click();
  $('#btnImport').addEventListener('click', pedir);
  $('#btnImport2').addEventListener('click', pedir);
  $('#fileInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) importar(f);
  });
  $('#btnExport').addEventListener('click', exportar);
  $('#btnTheme').addEventListener('click', () => aplicarTema(temaActual === 'claro' ? 'oscuro' : 'claro'));
  $('#btnReset').addEventListener('click', vaciarCatalogo);

  // --- Arrastrar el archivo ---
  const empty = $('#empty');
  ['dragenter', 'dragover'].forEach(ev =>
    document.addEventListener(ev, (e) => { e.preventDefault(); empty.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev =>
    document.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'dragleave' && e.relatedTarget) return;
      empty.classList.remove('drag');
    }));
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) importar(f);
  });

  // --- Atajo "/" para buscar ---
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('#search') && $('#modal').hidden) {
      e.preventDefault(); $('#search').focus();
    }
  });

  // En pantallas táctiles no tiene sentido hablar de arrastrar el archivo,
  // pero sí conviene recordar lo de la pantalla de inicio (si el navegador
  // borra los datos, se pierde el catálogo).
  if (matchMedia('(pointer: coarse)').matches) {
    $('#emptyPhoneTip').hidden = false;
    const arrastrar = $('#empty .empty-tip');
    if (arrastrar) arrastrar.remove();
  }
}

/* -------------------------------------------------------------------------
   11. ARRANQUE
   ------------------------------------------------------------------------- */
async function iniciar() {
  conectarEventos();
  try {
    await openDB();
    temaActual = (await Store.getMeta('tema', 'oscuro')) || 'oscuro';
    await aplicarTema(temaActual);
    await cargarTodo();
    state.metaUltimo = await Store.getMeta('ultimoBackup', null);
    pintarPie();
  } catch (err) {
    console.error(err);
    const esCelular = matchMedia('(pointer: coarse)').matches || window.innerWidth < 700;
    $('#emptyMsg').innerHTML = esCelular
      ? 'No se pudo abrir el almacenamiento del navegador.<br>Revisa que no estés en modo privado/incóognito y vuelve a cargar la página.'
      : 'No se pudo abrir la base de datos local del navegador.<br>Intenta abrir la app desde <strong>INICIAR CATALOGO.bat</strong> (no con doble clic en index.html).';
    return;
  }

  // Service worker: la app queda instalable y funciona sin internet.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin offline */ });
  }

  // Atajo: el filtro de categoría vive en el contenedor de las etiquetas.
  state.catSel = '';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}

/* Puente de pruebas: solo se activa si la pagina se abre con ?test=1.
   Sirve para automatizar la revision del catalogo; en uso normal no existe. */
if (/[?&]test=1/.test(location.search)) {
  window.__estado = state;
  window.__importar = importar;
  window.__contarDB = async () => ({
    productos: (await Store.getAllProductos()).length,
    fotos: (await Store.getAllFotos()).length
  });
  window.__exportarJSON = async () => {
    const fotos = await Store.getAllFotos();
    const imagenes = {}, imgUrl = {};
    fotos.forEach(f => {
      if (f.imgs && f.imgs.length) imagenes[f.id] = f.imgs;
      if (f.urls && f.urls.filter(Boolean).length) imgUrl[f.id] = f.urls;
    });
    return {
      _tipo: 'catalogo_tienda', version: 1, fecha: todayISO(),
      productos: state.productos,
      categorias: state.categorias.map(c => c.nombre),
      imagenes: imagenes, imgUrl: imgUrl
    };
  };
}

})();
