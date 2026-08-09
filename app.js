/* =========================================================================
   STOCKFERRE — Consulta rápida de productos (100% frontend, offline-first)
   Escaneas un código con la cámara (OCR) o lo escribes, y ves al instante:
   código, descripción, marca, categoría, precio de compra y de venta.
   Todo editable. Persistencia: LocalStorage. Sin Google Sheets.
   ========================================================================= */

const STORAGE_KEY = 'stockferre_catalogo_v1';

let db = null;

/* -------------------------------------------------------------------------
   1. MODELO DE DATOS + PERSISTENCIA LOCAL
   ------------------------------------------------------------------------- */

function defaultDB(){
  return {
    productos: [],
    categorias: [],
    contador: { producto: 1 }
  };
}

function loadDB(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      db = JSON.parse(raw);
      db.productos = db.productos || [];
      db.categorias = db.categorias || [];
      db.contador = db.contador || { producto: 1 };
      return;
    }
  }catch(e){ console.error('Error leyendo LocalStorage', e); }
  db = defaultDB();
  saveDB();
}

function saveDB(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }catch(e){
    console.error('Error guardando en LocalStorage', e);
    toast('No se pudo guardar en el almacenamiento local (¿espacio lleno?)', 'error');
  }
}

/* -------------------------------------------------------------------------
   2. UTILIDADES
   ------------------------------------------------------------------------- */

function uid(){
  const n = db.contador.producto++;
  return 'p' + n + '_' + Date.now().toString(36);
}

function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtMoney(n){
  n = Number(n) || 0;
  return 'Bs ' + n.toFixed(2);
}

function normalize(str){
  return String(str||'').toUpperCase().trim();
}

function todayISO(){
  return new Date().toISOString();
}

/* -------------------------------------------------------------------------
   3. PRODUCTOS — CRUD
   ------------------------------------------------------------------------- */

function getProductoByCodigo(codigo){
  const c = normalize(codigo);
  return db.productos.find(p => normalize(p.codigo) === c) || null;
}

function getProductoById(id){
  return db.productos.find(p => p.id === id) || null;
}

function upsertCategoria(nombre){
  const n = String(nombre||'').trim();
  if(!n) return;
  const exists = db.categorias.some(c => normalize(c) === normalize(n));
  if(!exists) db.categorias.push(n);
}

function saveProducto(data){
  upsertCategoria(data.categoria);

  if(data.id){
    const p = getProductoById(data.id);
    if(!p) return null;
    p.codigo = data.codigo.trim();
    p.nombre = data.nombre.trim();
    p.marca = data.marca.trim();
    p.categoria = data.categoria.trim();
    p.precioCompra = parseFloat(data.precioCompra) || 0;
    p.precioMarca = parseFloat(data.precioMarca) || 0;
    p.precioVenta = parseFloat(data.precioVenta) || 0;
    saveDB();
    return p;
  }else{
    // Si ya existe un producto con ese código, actualízalo en vez de duplicar
    const existing = getProductoByCodigo(data.codigo);
    if(existing){
      existing.nombre = data.nombre.trim();
      existing.marca = data.marca.trim();
      existing.categoria = data.categoria.trim();
      existing.precioCompra = parseFloat(data.precioCompra) || 0;
      existing.precioMarca = parseFloat(data.precioMarca) || 0;
      existing.precioVenta = parseFloat(data.precioVenta) || 0;
      saveDB();
      return existing;
    }
    const p = {
      id: uid(),
      codigo: data.codigo.trim(),
      nombre: data.nombre.trim(),
      marca: data.marca.trim(),
      categoria: data.categoria.trim(),
      precioCompra: parseFloat(data.precioCompra) || 0,
      precioMarca: parseFloat(data.precioMarca) || 0,
      precioVenta: parseFloat(data.precioVenta) || 0,
      fechaCreacion: todayISO()
    };
    db.productos.push(p);
    saveDB();
    return p;
  }
}

function deleteProducto(id){
  confirmDialog('Eliminar producto', '¿Seguro que quieres eliminar este producto? Esta acción no se puede deshacer.', ()=>{
    db.productos = db.productos.filter(p => p.id !== id);
    saveDB();
    renderProductos();
    renderCategorias();
    toast('Producto eliminado', 'success');
  });
}

/* -------------------------------------------------------------------------
   4. VISTA: ESCÁNER / RESULTADO
   ------------------------------------------------------------------------- */

function renderScanResult(codigo){
  const resultDiv = document.getElementById('scanResult');
  const p = getProductoByCodigo(codigo);

  if(!p){
    resultDiv.innerHTML = `
      <div class="scan-not-found">
        ⚠️ No se encontró ningún producto con el código <strong>${escapeHtml(codigo)}</strong>.
        <div style="margin-top:10px;">
          <button class="btn btn-primary btn-sm" id="btnCreateFromScan">+ Crear producto con este código</button>
        </div>
      </div>`;
    document.getElementById('btnCreateFromScan').addEventListener('click', ()=>{
      openProductModal(null, codigo);
    });
    return;
  }

  resultDiv.innerHTML = `
    <div class="scan-result-card">
      <h4>📦 ${escapeHtml(p.nombre)}</h4>
      <div class="sr-row"><span>Código</span><strong>${escapeHtml(p.codigo)}</strong></div>
      <div class="sr-row"><span>Marca</span><strong>${escapeHtml(p.marca || '-')}</strong></div>
      <div class="sr-row"><span>Categoría</span><strong>${escapeHtml(p.categoria || '-')}</strong></div>
      <div class="sr-row"><span>Precio de compra</span><strong>${fmtMoney(p.precioCompra)}</strong></div>
      <div class="sr-row"><span>Precio de marca</span><strong>${fmtMoney(p.precioMarca)}</strong></div>
      <div class="sr-row"><span>Precio de venta</span><strong>${fmtMoney(p.precioVenta)}</strong></div>
      <div style="margin-top:12px;">
        <button class="btn btn-secondary btn-sm" id="btnEditFromScan">✏️ Editar producto</button>
      </div>
    </div>`;
  document.getElementById('btnEditFromScan').addEventListener('click', ()=>{
    openProductModal(p);
  });
}

function handleScannedCode(codigo){
  codigo = String(codigo).trim();
  if(!codigo) return;
  renderScanResult(codigo);
}

/* -------------------------------------------------------------------------
   5. VISTA: PRODUCTOS (tabla, búsqueda, filtro por categoría)
   ------------------------------------------------------------------------- */

function populateCategoryFilter(){
  const sel = document.getElementById('prodFilterCategoria');
  const current = sel.value;
  const cats = getAllCategoryNames();
  sel.innerHTML = '<option value="">Todas las categorías</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if(cats.includes(current)) sel.value = current;
}

function populateCategoryDatalist(){
  const dl = document.getElementById('categoriasList');
  dl.innerHTML = getAllCategoryNames().map(c => `<option value="${escapeHtml(c)}">`).join('');
}

function getAllCategoryNames(){
  const set = new Set(db.categorias.map(c => c.trim()).filter(Boolean));
  db.productos.forEach(p => { if(p.categoria) set.add(p.categoria.trim()); });
  return Array.from(set).sort((a,b)=> a.localeCompare(b, 'es'));
}

function renderProductos(){
  populateCategoryFilter();
  populateCategoryDatalist();

  const search = normalize(document.getElementById('prodSearch').value);
  const catFilter = document.getElementById('prodFilterCategoria').value;

  let list = db.productos.slice();
  if(catFilter){
    list = list.filter(p => normalize(p.categoria) === normalize(catFilter));
  }
  if(search){
    list = list.filter(p =>
      normalize(p.nombre).includes(search) ||
      normalize(p.codigo).includes(search) ||
      normalize(p.marca).includes(search)
    );
  }
  list.sort((a,b)=> a.nombre.localeCompare(b.nombre, 'es'));

  const tbody = document.querySelector('#productsTable tbody');
  if(list.length === 0){
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No hay productos que coincidan.</td></tr>`;
  }else{
    tbody.innerHTML = list.map(p => `
      <tr>
        <td><strong>${escapeHtml(p.codigo)}</strong></td>
        <td>${escapeHtml(p.nombre)}</td>
        <td>${escapeHtml(p.marca || '-')}</td>
        <td>${p.categoria ? `<span class="badge badge-muted">${escapeHtml(p.categoria)}</span>` : '-'}</td>
        <td>${fmtMoney(p.precioCompra)}</td>
        <td>${fmtMoney(p.precioMarca)}</td>
        <td>${fmtMoney(p.precioVenta)}</td>
        <td>
          <button class="btn-icon" title="Editar" data-edit-product="${p.id}">✏️</button>
          <button class="btn-icon" title="Eliminar" data-delete-product="${p.id}">🗑️</button>
        </td>
      </tr>
    `).join('');
  }

  document.getElementById('sidebarProductCount').textContent =
    `${db.productos.length} producto${db.productos.length === 1 ? '' : 's'} · Datos locales`;
}

/* -------------------------------------------------------------------------
   6. VISTA: CATEGORÍAS (botones para filtrar)
   ------------------------------------------------------------------------- */

function renderCategorias(){
  const grid = document.getElementById('categoriesGrid');
  const cats = getAllCategoryNames();

  if(cats.length === 0){
    grid.innerHTML = `<p class="hint">Aún no hay categorías. Agrega una arriba o crea productos con categoría.</p>`;
    return;
  }

  grid.innerHTML = cats.map(c => {
    const count = db.productos.filter(p => normalize(p.categoria) === normalize(c)).length;
    return `
      <button class="stat-card" style="text-align:left; cursor:pointer; border:none;" data-filter-category="${escapeHtml(c)}">
        <div class="stat-label">${escapeHtml(c)}</div>
        <div class="stat-value">${count}</div>
      </button>`;
  }).join('');

  grid.querySelectorAll('[data-filter-category]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const cat = btn.dataset.filterCategory;
      showView('productos');
      document.getElementById('prodFilterCategoria').value = cat;
      renderProductos();
    });
  });
}

/* -------------------------------------------------------------------------
   7. MODAL DE PRODUCTO
   ------------------------------------------------------------------------- */

function openProductModal(producto, prefillCodigo){
  const form = document.getElementById('formProducto');
  form.reset();
  populateCategoryDatalist();

  if(producto){
    document.getElementById('modalProductoTitle').textContent = 'Editar producto';
    document.getElementById('pId').value = producto.id;
    document.getElementById('pCodigo').value = producto.codigo;
    document.getElementById('pNombre').value = producto.nombre;
    document.getElementById('pMarca').value = producto.marca || '';
    document.getElementById('pCategoria').value = producto.categoria || '';
    document.getElementById('pPrecioCompra').value = producto.precioCompra || '';
    document.getElementById('pPrecioMarca').value = producto.precioMarca || '';
    document.getElementById('pPrecioVenta').value = producto.precioVenta || '';
  }else{
    document.getElementById('modalProductoTitle').textContent = 'Nuevo producto';
    document.getElementById('pId').value = '';
    if(prefillCodigo) document.getElementById('pCodigo').value = prefillCodigo;
  }
  openModal('modalProducto');
}

function handleProductSubmit(e){
  e.preventDefault();
  const data = {
    id: document.getElementById('pId').value || null,
    codigo: document.getElementById('pCodigo').value,
    nombre: document.getElementById('pNombre').value,
    marca: document.getElementById('pMarca').value,
    categoria: document.getElementById('pCategoria').value,
    precioCompra: document.getElementById('pPrecioCompra').value,
    precioMarca: document.getElementById('pPrecioMarca').value,
    precioVenta: document.getElementById('pPrecioVenta').value
  };
  if(!data.codigo.trim() || !data.nombre.trim()){
    toast('Código y descripción son obligatorios', 'error');
    return;
  }
  // Evitar duplicar código en otro producto distinto
  const dup = getProductoByCodigo(data.codigo);
  if(dup && dup.id !== data.id){
    toast('Ya existe otro producto con ese código', 'error');
    return;
  }
  const saved = saveProducto(data);
  closeAllModals();
  renderProductos();
  renderCategorias();
  toast('Producto guardado', 'success');
  // Si venimos del escáner, refresca el resultado mostrado
  if(saved) renderScanResult(saved.codigo);
}

/* -------------------------------------------------------------------------
   8. IMPORTAR CSV DE PRODUCTOS
   ------------------------------------------------------------------------- */

// Excel en español guarda "CSV separado por comas" usando en realidad punto y
// coma (porque usa la coma como separador decimal de los precios). Detectamos
// el delimitador real mirando la primera línea del archivo.
function detectDelimiter(text){
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] || '';
  const candidates = [',', ';', '\t'];
  let best = ',', bestCount = 0;
  candidates.forEach(d=>{
    const count = firstLine.split(d).length - 1;
    if(count > bestCount){ bestCount = count; best = d; }
  });
  return best;
}

// Parser CSV: soporta coma, punto y coma o tabulador como delimitador,
// y campos entre comillas.
function parseCSV(text, delimiter){
  // Quita el BOM (marca de orden de bytes) que Excel agrega al guardar "CSV UTF-8"
  text = text.replace(/^\uFEFF/, '');
  text = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  delimiter = delimiter || detectDelimiter(text);

  const rows = [];
  let row = [], field = '', inQuotes = false;

  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(inQuotes){
      if(ch === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else{ inQuotes = false; }
      }else{
        field += ch;
      }
    }else{
      if(ch === '"'){ inQuotes = true; }
      else if(ch === delimiter){ row.push(field); field = ''; }
      else if(ch === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
      else{ field += ch; }
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function normalizeHeader(h){
  return String(h||'')
    .trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // quita acentos
    .replace(/\s+/g,' ');
}

function parsePrecio(raw){
  if(raw === undefined || raw === null) return 0;
  const cleaned = String(raw).trim().replace(/[^\d.,-]/g,'');
  if(!cleaned) return 0;
  // Si usa coma como decimal y no hay punto, conviértela
  const normalized = (cleaned.includes(',') && !cleaned.includes('.'))
    ? cleaned.replace(',', '.')
    : cleaned.replace(/,/g,'');
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

function importProductsCSV(file){
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      const rows = parseCSV(e.target.result);
      if(rows.length < 2){
        toast('El archivo CSV no tiene datos', 'error');
        return;
      }
      const headers = rows[0].map(normalizeHeader);
      const idx = {
        codigo: headers.indexOf('CODIGO'),
        nombre: headers.findIndex(h => h.includes('DESCRIPCION') || h === 'NOMBRE'),
        marca: headers.indexOf('MARCA'),
        categoria: headers.indexOf('CATEGORIA'),
        // Acepta "PRECIO COMPRA", "PRECIO DE COMPRA", "PRECIO_COMPRA", etc.
        precioCompra: headers.findIndex(h => h.includes('PRECIO') && h.includes('COMPRA')),
        precioMarca: headers.findIndex(h => h.includes('PRECIO') && h.includes('MARCA')),
        precioVenta: headers.findIndex(h => h.includes('PRECIO') && h.includes('VENTA'))
      };
      if(idx.codigo === -1 || idx.nombre === -1){
        toast('El CSV debe tener al menos columnas CODIGO y DESCRIPCION', 'error');
        return;
      }
      if(idx.precioCompra === -1 || idx.precioVenta === -1){
        toast('No se encontraron las columnas de precio (se importarán los productos, pero revisa los precios manualmente)', 'warning');
      }

      let creados = 0, actualizados = 0;
      for(let i = 1; i < rows.length; i++){
        const r = rows[i];
        const codigo = String(r[idx.codigo] || '').trim();
        if(!codigo) continue;
        const nombre = String(r[idx.nombre] || '').trim();
        const marca = idx.marca > -1 ? String(r[idx.marca] || '').trim() : '';
        const categoria = idx.categoria > -1 ? String(r[idx.categoria] || '').trim() : '';
        const precioCompra = idx.precioCompra > -1 ? parsePrecio(r[idx.precioCompra]) : 0;
        const precioMarca = idx.precioMarca > -1 ? parsePrecio(r[idx.precioMarca]) : 0;
        const precioVenta = idx.precioVenta > -1 ? parsePrecio(r[idx.precioVenta]) : 0;

        if(categoria) upsertCategoria(categoria);

        const existing = getProductoByCodigo(codigo);
        if(existing){
          existing.nombre = nombre || existing.nombre;
          existing.marca = marca || existing.marca;
          existing.categoria = categoria || existing.categoria;
          existing.precioCompra = precioCompra || existing.precioCompra;
          existing.precioMarca = precioMarca || existing.precioMarca;
          existing.precioVenta = precioVenta || existing.precioVenta;
          actualizados++;
        }else{
          db.productos.push({
            id: uid(),
            codigo, nombre, marca, categoria,
            precioCompra, precioMarca, precioVenta,
            fechaCreacion: todayISO()
          });
          creados++;
        }
      }
      saveDB();
      renderProductos();
      renderCategorias();
      toast(`Importación completa: ${creados} nuevos, ${actualizados} actualizados`, 'success');
    }catch(err){
      console.error(err);
      toast('No se pudo leer el archivo CSV. Verifica el formato.', 'error');
    }
  };
  reader.onerror = ()=> toast('Error al leer el archivo', 'error');
  reader.readAsText(file, 'UTF-8');
}

/* -------------------------------------------------------------------------
   9. BACKUP / RESTAURAR (JSON)
   ------------------------------------------------------------------------- */

function exportBackup(){
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stockferre_backup_${todayISO().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Backup exportado', 'success');
}

function importBackup(file){
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      const parsed = JSON.parse(e.target.result);
      if(!parsed || !Array.isArray(parsed.productos)){
        toast('El archivo no tiene un formato de backup válido', 'error');
        return;
      }
      confirmDialog('Restaurar backup', 'Esto reemplazará todos los productos y categorías actuales. ¿Continuar?', ()=>{
        db = {
          productos: parsed.productos || [],
          categorias: parsed.categorias || [],
          contador: parsed.contador || { producto: (parsed.productos.length || 0) + 1 }
        };
        saveDB();
        renderProductos();
        renderCategorias();
        toast('Backup restaurado correctamente', 'success');
      });
    }catch(err){
      console.error(err);
      toast('No se pudo leer el archivo de backup', 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function factoryReset(){
  confirmDialog('Borrar todos los datos', 'Esto eliminará permanentemente todos los productos y categorías guardados en este dispositivo. ¿Estás seguro?', ()=>{
    db = defaultDB();
    saveDB();
    renderProductos();
    renderCategorias();
    document.getElementById('scanResult').innerHTML = '';
    toast('Datos borrados', 'success');
  });
}

/* -------------------------------------------------------------------------
   10. NAVEGACIÓN / VISTAS
   ------------------------------------------------------------------------- */

const VIEW_TITLES = {
  escaner: 'Escanear',
  productos: 'Productos',
  categorias: 'Categorías',
  config: 'Configuración'
};

function showView(name){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-item[data-view]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.view === name);
  });
  document.getElementById('viewTitle').textContent = VIEW_TITLES[name] || '';
  closeSidebarMobile();

  if(name === 'productos') renderProductos();
  if(name === 'categorias') renderCategorias();
  if(name === 'escaner'){
    document.getElementById('scanResult').innerHTML = '';
    if(!ocrActive) startOcrScanner();
  }else{
    stopOcrScanner();
  }
}

function closeSidebarMobile(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

/* -------------------------------------------------------------------------
   11. MODALES / TOASTS / CONFIRMACIÓN
   ------------------------------------------------------------------------- */

function openModal(id){
  document.getElementById('modalBackdrop').classList.add('open');
  document.getElementById(id).classList.add('open');
}
function closeAllModals(){
  document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
  document.getElementById('modalBackdrop').classList.remove('open');
}

let confirmCallback = null;
function confirmDialog(title, message, onAccept){
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmCallback = onAccept;
  openModal('modalConfirm');
}

function toast(message, type){
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(()=>{ el.remove(); }, 3200);
}

/* -------------------------------------------------------------------------
   12. ESCÁNER DE TEXTO / OCR (Tesseract.js)
   Lee códigos numéricos (12345) y alfanuméricos (HNV3445, TR1223, TR23-23)
   impresos en etiquetas, en tiempo real, sin tomar fotos.
   ------------------------------------------------------------------------- */

// Palabras que suelen aparecer junto al código en las etiquetas y deben ignorarse
const OCR_IGNORE_WORDS = [
  'NUEVO','NEW','OFERTA','DESCUENTO','EXCELENTE','EXC','IMPORTADO','IMPORT',
  'PROMO','PROMOCION','CALIDAD','GARANTIA','ORIGINAL','SALE','STOCK','PRECIO',
  'FERRETERIA','BOLIVIA','MARCA','MODELO','PROD','PRODUCTO'
];

// Dos modos de escaneo: numérico puro (más preciso para códigos como 17736)
// y alfanumérico (2-4 letras + 2-5 números, guion opcional, ej: HNV3445)
const OCR_MODES = {
  numerico: {
    pattern: /^[0-9]{3,8}$/,
    whitelist: '0123456789'
  },
  alfanumerico: {
    pattern: /^[A-Z]{2,4}[0-9]{2,5}(-[0-9]{2,4})?$/,
    whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'
  }
};

let scanCodeMode = 'numerico';

const OCR_INTERVAL_MS = 600;

let ocrWorker = null;
let ocrStream = null;
let ocrTimer = null;
let ocrBusy = false;
let ocrActive = false;

function cleanOcrToken(raw){
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g,'').trim();
}

function extractCandidateCodes(text){
  if(!text) return [];
  const pattern = OCR_MODES[scanCodeMode].pattern;
  const tokens = text.split(/[\s\n\r,;:|]+/).map(cleanOcrToken).filter(Boolean);
  const seen = new Set();
  const candidates = [];
  tokens.forEach(tok=>{
    if(seen.has(tok)) return;
    seen.add(tok);
    if(OCR_IGNORE_WORDS.includes(tok)) return;
    if(pattern.test(tok)) candidates.push(tok);
  });
  return candidates;
}

function pickBestCandidate(candidates){
  if(candidates.length === 0) return null;
  const existing = candidates.find(c => getProductoByCodigo(c));
  if(existing) return existing;
  return candidates[0];
}

function setOcrStatus(msg){
  const el = document.getElementById('ocrStatus');
  if(el) el.textContent = msg;
}

let ocrStarting = false;

async function startOcrScanner(){
  if(ocrActive || ocrStarting) return;
  ocrStarting = true;

  if(typeof Tesseract === 'undefined'){
    setOcrStatus('No se pudo cargar Tesseract.js. Verifica tu conexión a internet o usa la búsqueda manual.');
    ocrStarting = false;
    return;
  }

  const videoEl = document.getElementById('ocrVideo');

  try{
    setOcrStatus('Iniciando cámara...');
    ocrStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    videoEl.srcObject = ocrStream;
    await videoEl.play();
  }catch(err){
    console.warn(err);
    setOcrStatus('No se pudo acceder a la cámara. Verifica los permisos del navegador o usa la búsqueda manual.');
    ocrStarting = false;
    return;
  }

  try{
    setOcrStatus('Preparando el lector de texto...');
    ocrWorker = await Tesseract.createWorker('eng');
    await ocrWorker.setParameters({
      tessedit_char_whitelist: OCR_MODES[scanCodeMode].whitelist,
      tessedit_pageseg_mode: '6'
    });
  }catch(err){
    console.warn(err);
    setOcrStatus('No se pudo iniciar el motor de lectura de texto. Verifica tu conexión a internet.');
    ocrStarting = false;
    return;
  }

  ocrActive = true;
  ocrStarting = false;
  setOcrStatus('🔎 Buscando código...');
  scheduleNextOcrCapture();
}

function scheduleNextOcrCapture(){
  if(!ocrActive) return;
  ocrTimer = setTimeout(runOcrCapture, OCR_INTERVAL_MS);
}

// Convierte el recorte a blanco y negro (umbral) para que Tesseract lea
// mucho mejor las etiquetas fotografiadas con la cámara del celular.
function preprocessCanvas(canvas){
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;

  // 1) escala de grises
  const gray = new Uint8ClampedArray(canvas.width * canvas.height);
  for(let i = 0, j = 0; i < d.length; i += 4, j++){
    gray[j] = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
  }

  // 2) umbral automático simple (media de brillo) para binarizar
  let sum = 0;
  for(let j = 0; j < gray.length; j++) sum += gray[j];
  const mean = sum / gray.length;
  const threshold = mean * 0.9; // un poco por debajo de la media favorece texto oscuro sobre fondo claro

  for(let i = 0, j = 0; i < d.length; i += 4, j++){
    const v = gray[j] > threshold ? 255 : 0;
    d[i] = d[i+1] = d[i+2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
}

async function runOcrCapture(){
  if(!ocrActive || ocrBusy) return;
  const videoEl = document.getElementById('ocrVideo');
  const canvasEl = document.getElementById('ocrCanvas');
  if(!videoEl || !videoEl.videoWidth){ scheduleNextOcrCapture(); return; }

  ocrBusy = true;
  try{
    // Recorta una franja pequeña y central para enfocar la etiqueta (~20cm)
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    const cropW = vw * 0.7, cropH = vh * 0.26;
    const cropX = (vw - cropW) / 2, cropY = (vh - cropH) / 2;

    // Escala x2 el recorte: los códigos son pequeños en la imagen original
    // y una imagen más grande mejora mucho la precisión del OCR.
    const scale = 2;
    canvasEl.width = cropW * scale;
    canvasEl.height = cropH * scale;
    const ctx = canvasEl.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, canvasEl.width, canvasEl.height);
    preprocessCanvas(canvasEl);

    setOcrStatus('🔎 Analizando etiqueta...');
    const { data: { text } } = await ocrWorker.recognize(canvasEl);
    const candidates = extractCandidateCodes(text);
    const best = pickBestCandidate(candidates);

    if(best){
      const now = Date.now();
      if(!(window.__lastOcrCode === best && now - (window.__lastOcrTime||0) < 3000)){
        window.__lastOcrCode = best;
        window.__lastOcrTime = now;
        handleScannedCode(best);
      }
    }
    if(ocrActive) setOcrStatus('🔎 Buscando código...');
  }catch(err){
    console.warn('Error de OCR', err);
  }finally{
    ocrBusy = false;
    scheduleNextOcrCapture();
  }
}

function stopOcrScanner(){
  ocrActive = false;
  ocrStarting = false;
  if(ocrTimer){ clearTimeout(ocrTimer); ocrTimer = null; }
  if(ocrStream){
    ocrStream.getTracks().forEach(t => t.stop());
    ocrStream = null;
  }
  const videoEl = document.getElementById('ocrVideo');
  if(videoEl) videoEl.srcObject = null;
  if(ocrWorker){
    const w = ocrWorker;
    ocrWorker = null;
    w.terminate().catch(()=>{});
  }
  setOcrStatus('Iniciando cámara...');
}

async function setScanCodeMode(mode){
  if(!OCR_MODES[mode] || mode === scanCodeMode) return;
  scanCodeMode = mode;
  document.querySelectorAll('[data-scan-code-mode]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.scanCodeMode === mode);
  });
  // Si el lector ya está activo, actualiza el whitelist de caracteres sin reiniciar la cámara
  if(ocrWorker){
    try{
      await ocrWorker.setParameters({ tessedit_char_whitelist: OCR_MODES[mode].whitelist });
    }catch(err){ console.warn(err); }
  }
}

/* -------------------------------------------------------------------------
   13. EVENTOS / INICIALIZACIÓN
   ------------------------------------------------------------------------- */

function setupEventListeners(){
  // Navegación
  document.querySelectorAll('.nav-item[data-view]').forEach(btn=>{
    btn.addEventListener('click', ()=> showView(btn.dataset.view));
  });

  // Sidebar móvil
  document.getElementById('hamburgerBtn').addEventListener('click', ()=>{
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('open');
  });
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebarMobile);

  // Cerrar modales
  document.querySelectorAll('[data-close-modal]').forEach(btn=>{
    btn.addEventListener('click', closeAllModals);
  });
  document.getElementById('modalBackdrop').addEventListener('click', closeAllModals);

  // Confirm modal
  document.getElementById('confirmAcceptBtn').addEventListener('click', ()=>{
    if(confirmCallback) confirmCallback();
    confirmCallback = null;
    closeAllModals();
  });

  // Escáner
  document.querySelectorAll('[data-scan-code-mode]').forEach(btn=>{
    btn.addEventListener('click', ()=> setScanCodeMode(btn.dataset.scanCodeMode));
  });
  document.getElementById('btnManualCodeGo').addEventListener('click', ()=>{
    const val = document.getElementById('manualCodeInput').value.trim();
    if(val) handleScannedCode(val);
  });
  document.getElementById('manualCodeInput').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){
      e.preventDefault();
      const val = e.target.value.trim();
      if(val) handleScannedCode(val);
    }
  });

  // Productos
  document.getElementById('btnNewProduct').addEventListener('click', ()=> openProductModal());
  document.getElementById('formProducto').addEventListener('submit', handleProductSubmit);
  document.getElementById('prodSearch').addEventListener('input', renderProductos);
  document.getElementById('prodFilterCategoria').addEventListener('change', renderProductos);
  document.querySelector('#productsTable tbody').addEventListener('click', (e)=>{
    const editId = e.target.closest('[data-edit-product]')?.dataset.editProduct;
    const delId = e.target.closest('[data-delete-product]')?.dataset.deleteProduct;
    if(editId) openProductModal(getProductoById(editId));
    if(delId) deleteProducto(delId);
  });

  // Categorías
  document.getElementById('btnAddCategory').addEventListener('click', ()=>{
    const input = document.getElementById('newCategoryInput');
    const val = input.value.trim();
    if(!val){ toast('Escribe un nombre de categoría', 'error'); return; }
    upsertCategoria(val);
    saveDB();
    input.value = '';
    renderCategorias();
    toast('Categoría agregada', 'success');
  });

  // Importaciones CSV (desde Productos y desde Configuración)
  document.getElementById('btnImportProducts').addEventListener('click', ()=> document.getElementById('fileImportProducts').click());
  document.getElementById('btnImportProductsConfig').addEventListener('click', ()=> document.getElementById('fileImportProducts').click());
  document.getElementById('fileImportProducts').addEventListener('change', (e)=>{
    if(e.target.files[0]) importProductsCSV(e.target.files[0]);
    e.target.value = '';
  });

  // Backup / Configuración
  document.getElementById('btnExportBackup').addEventListener('click', exportBackup);
  document.getElementById('btnImportBackup').addEventListener('click', ()=> document.getElementById('fileImportBackup').click());
  document.getElementById('fileImportBackup').addEventListener('change', (e)=>{
    if(e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btnFactoryReset').addEventListener('click', factoryReset);
}

function init(){
  loadDB();
  setupEventListeners();
  showView('escaner');
}

document.addEventListener('DOMContentLoaded', init);
