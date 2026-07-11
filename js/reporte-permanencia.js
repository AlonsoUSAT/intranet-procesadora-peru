'use strict';

/* ═══════════════════════════════════════════════════
   REPORTE PERMANENCIA — Procesadora Perú S.A.C.
   Consume EXCLUSIVAMENTE las APIs oficiales vía api-config.js:
     GET /api/nisira/sucursales
     GET /api/nisira/sucursales/{id}/almacenes
     GET /api/almacen/inventarios?...

   ─────────────────────────────────────────────────
   LÓGICA DE "PERMANENCIA" (100% calculada desde datos reales,
   sin valores inventados ni Math.random):

   La API de inventarios NO entrega una hora de "entrada" y
   "salida" explícita. Lo que entrega es UN REGISTRO POR PRODUCTO
   contado, cada uno con su propio fechaCreacion.

   Para reconstruir la permanencia de un operario en un almacén,
   agrupamos sus registros en "SESIONES":
     1. Se agrupan los registros por usuarioCreacion + idAlmacen.
     2. Se ordenan por fechaCreacion.
     3. Si entre un registro y el siguiente pasan más de
        SESION_GAP_MINUTOS minutos, se considera que la sesión
        anterior terminó y empieza una nueva (el operario salió
        y volvió en otro momento).
     4. Por cada sesión:
          - Entrada = fechaCreacion del primer registro
          - Salida  = fechaCreacion del último registro
          - Tiempo Total = Salida - Entrada
        Si la sesión tiene un solo registro, no hay forma de
        saber cuánto duró → se muestra "—" en Tiempo Total.

   [CONFIG] PARA AJUSTAR LA VENTANA DE SESIÓN:
      Cambiar la constante SESION_GAP_MINUTOS más abajo.

   [CONFIG] PARA AJUSTAR LA FÓRMULA DE EFICIENCIA:
      Ver función calcularKPIs(). Ahí se explica qué se usa.
   ═══════════════════════════════════════════════════ */

// ─── Configuración ajustable ──────────────────────────
const SESION_GAP_MINUTOS = 30; // ← cambia aquí la ventana de inactividad que corta una sesión

// Fechas por defecto: última semana
const hoy   = new Date();
const hace7 = new Date();
hace7.setDate(hoy.getDate() - 7);
const fmt = d => d.toISOString().split('T')[0];

document.getElementById('fechaInicio').value = fmt(hace7);
document.getElementById('fechaFin').value    = fmt(hoy);

/* ── ALMACENES desde API oficial ── */
async function cargarAlmacenes() {
  try {
    // API OFICIAL: GET /api/nisira/sucursales
    const sucursales = await apiGetSucursales();

    const sel = document.getElementById('selectorAlmacen');

    // Para cada sucursal, obtener sus almacenes
    for (const suc of (sucursales || [])) {
      try {
        // API OFICIAL: GET /api/nisira/sucursales/{id}/almacenes
        const almacenes = await apiGetAlmacenes(suc.idSucursal);
        (almacenes || []).forEach(alm => {
          const opt = document.createElement('option');
          opt.value = `${suc.idSucursal}|${alm.idAlmacen}`;
          opt.textContent = `${suc.descripcion} — ${alm.descripcion}`;
          sel.appendChild(opt);
        });
      } catch (e) {
        console.warn(`[Permanencia] Error cargando almacenes de sucursal ${suc.idSucursal}:`, e);
      }
    }
  } catch(e) {
    console.error('[Permanencia] Error cargando sucursales:', e);
  }
}

/* ── DATOS ── */
let todosLosRegistros = [];   // registros crudos de la API (uno por producto contado)
let sesionesActuales  = [];   // registros agrupados en sesiones de permanencia
let detalleActual     = [];   // registros crudos enriquecidos con tiempoEnAlmacenMin
let paginaActual = 1;
const POR_PAGINA = 10;

/* ── TAB ACTIVO ── */
let tabActivo = 'sesiones'; // 'sesiones' | 'detalle'

function cambiarTab(tab) {
  tabActivo = tab;
  document.getElementById('tab-btn-sesiones').classList.toggle('tab-activo', tab === 'sesiones');
  document.getElementById('tab-btn-detalle').classList.toggle('tab-activo', tab === 'detalle');

  // Actualizar encabezados de la tabla según la vista
  const thead = document.getElementById('tablaHead');
  if (tab === 'detalle') {
    thead.innerHTML = `<tr>
      <th>Operario</th><th>Producto</th><th>Almacén</th>
      <th>Fecha/Hora</th><th>Cantidad</th><th>Tiempo en almacén</th>
    </tr>`;
  } else {
    thead.innerHTML = `<tr>
      <th>ID Operario</th><th>Nombre</th><th>Almacén</th>
      <th>Entrada</th><th>Salida</th><th>Tiempo Total</th>
    </tr>`;
  }

  paginaActual = 1;
  renderTabla();
}

async function cargarMovimientos() {
  const fi  = document.getElementById('fechaInicio').value;
  const ff  = document.getElementById('fechaFin').value;
  const almVal = document.getElementById('selectorAlmacen').value;

  if (!fi || !ff) return;

  // Parsear selección de sucursal|almacen
  let idSucursal = null;
  let idAlmacen  = null;
  if (almVal) {
    const partes = almVal.split('|');
    idSucursal = partes[0];
    idAlmacen  = partes[1];
  }

  try {
    // API OFICIAL: GET /api/almacen/inventarios?idSucursal=X&idAlmacen=Y&fechaInicio=X&fechaFin=Y
    const data = await apiConsultarInventarios(idSucursal, idAlmacen, fi, ff);

    todosLosRegistros = data || [];
    sesionesActuales   = construirSesiones(todosLosRegistros);
    detalleActual      = construirDetalle(todosLosRegistros);
    paginaActual = 1;
    renderTabla();
    calcularKPIs(sesionesActuales);

    // KPIs de operarios activos (sobre registros crudos, igual que antes)
    const operariosUnicos = new Set(todosLosRegistros.map(r => r.usuarioCreacion).filter(Boolean));
    document.getElementById('statusOperarios').textContent = `${operariosUnicos.size} operarios activos`;
    document.getElementById('statusRegistros').textContent = `${todosLosRegistros.length} registros`;
    document.getElementById('statusSync').textContent = '● SINCRONIZADO';
    document.getElementById('statusSync').style.color = '';

  } catch(e) {
    console.error('[Permanencia] Error:', e);
    document.getElementById('tablaBody').innerHTML =
      '<tr class="loading-row"><td colspan="6">Error al cargar datos. Verificar conexión.</td></tr>';
    document.getElementById('statusSync').textContent = 'SIN CONEXIÓN';
    document.getElementById('statusSync').style.color = '#DC2626';
  }
}

/* ═══════════════════════════════════════════════════
   DETALLE POR PRODUCTO
   Por cada registro crudo calcula cuántos minutos llevaba
   el operario en ese almacén cuando contó ese producto.
   Usa el mismo gap que construirSesiones para que los
   grupos coincidan exactamente.
   ═══════════════════════════════════════════════════ */
function construirDetalle(registros) {
  if (!registros || registros.length === 0) return [];

  const grupos = new Map();
  const gapMs  = SESION_GAP_MINUTOS * 60 * 1000;

  for (const r of registros) {
    if (!r.fechaCreacion) continue;
    const clave = `${r.usuarioCreacion || '—'}|${r.idAlmacen || r.almacen || '—'}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(r);
  }

  const resultado = [];

  for (const registrosGrupo of grupos.values()) {
    registrosGrupo.sort((a, b) => new Date(a.fechaCreacion) - new Date(b.fechaCreacion));

    let sesionInicio = 0;

    for (let i = 1; i <= registrosGrupo.length; i++) {
      const esUltimo = i === registrosGrupo.length;
      const cortar   = esUltimo || (
        new Date(registrosGrupo[i].fechaCreacion).getTime() -
        new Date(registrosGrupo[i - 1].fechaCreacion).getTime() > gapMs
      );

      if (cortar) {
        const sesion = registrosGrupo.slice(sesionInicio, i);
        const t0Ms   = new Date(sesion[0].fechaCreacion).getTime();

        sesion.forEach((r, idx) => {
          resultado.push({
            ...r,
            tiempoEnAlmacenMin: Math.round((new Date(r.fechaCreacion).getTime() - t0Ms) / 60000),
            esPrimero: idx === 0,
            esUltimo:  idx === sesion.length - 1,
          });
        });

        sesionInicio = i;
      }
    }
  }

  // Más reciente primero
  resultado.sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));
  return resultado;
}

/* ═══════════════════════════════════════════════════
   CONSTRUCCIÓN DE SESIONES DE PERMANENCIA
   Agrupa registros crudos (uno por producto) en sesiones
   de visita por operario + almacén, usando fechaCreacion.
   ═══════════════════════════════════════════════════ */
function construirSesiones(registros) {
  if (!registros || registros.length === 0) return [];

  // 1) Agrupar por operario + almacén
  const grupos = new Map(); // clave: "usuario|almacen" → array de registros
  for (const r of registros) {
    if (!r.fechaCreacion) continue; // sin fecha no se puede ubicar en el tiempo
    const clave = `${r.usuarioCreacion || '—'}|${r.idAlmacen || r.almacen || '—'}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(r);
  }

  const sesiones = [];
  const gapMs = SESION_GAP_MINUTOS * 60 * 1000;

  // 2) Por cada grupo, ordenar por fecha y partir en sesiones
  for (const registrosGrupo of grupos.values()) {
    registrosGrupo.sort((a, b) => new Date(a.fechaCreacion) - new Date(b.fechaCreacion));

    let sesionActual = [registrosGrupo[0]];

    for (let i = 1; i < registrosGrupo.length; i++) {
      const anterior = new Date(registrosGrupo[i - 1].fechaCreacion).getTime();
      const actual   = new Date(registrosGrupo[i].fechaCreacion).getTime();

      if (actual - anterior > gapMs) {
        // Gap mayor al permitido → cerrar sesión y abrir una nueva
        sesiones.push(cerrarSesion(sesionActual));
        sesionActual = [registrosGrupo[i]];
      } else {
        sesionActual.push(registrosGrupo[i]);
      }
    }
    sesiones.push(cerrarSesion(sesionActual));
  }

  // 3) Ordenar todas las sesiones por fecha de entrada, más reciente primero
  sesiones.sort((a, b) => new Date(b.entrada) - new Date(a.entrada));
  return sesiones;
}

/** Convierte un array de registros consecutivos en un objeto "sesión" */
function cerrarSesion(registros) {
  const primero = registros[0];
  const ultimo  = registros[registros.length - 1];

  const entradaMs = new Date(primero.fechaCreacion).getTime();
  const salidaMs  = new Date(ultimo.fechaCreacion).getTime();
  const duracionMin = registros.length > 1 ? Math.round((salidaMs - entradaMs) / 60000) : null;

  // Estado de la sesión: mismo criterio de negocio que antes, aplicado
  // ahora a la sesión completa (usamos la cantidad del último registro
  // contado, que es el estado "final" con el que cerró el operario).
  let estado, badgeClass;
  if (!ultimo.cantidad || ultimo.cantidad === 0) {
    estado = 'Activo';     badgeClass = 'badge-activo';
  } else if (ultimo.cantidad > 100) {
    estado = 'Excedido';   badgeClass = 'badge-excedido';
  } else {
    estado = 'Completado'; badgeClass = 'badge-completado';
  }

  const geo = primero.auditClientInfo;

  return {
    usuario:      primero.usuarioCreacion || '—',
    idOperario:   primero.idInventario || '—', // identificador de referencia (id del 1er registro de la sesión)
    almacen:      primero.almacen || primero.idAlmacen || '—',
    productos:    registros.length,             // cuántos productos contó en esta sesión
    entrada:      primero.fechaCreacion,
    salida:       ultimo.fechaCreacion,
    duracionMin,                                 // null si fue un solo registro (no se puede calcular)
    estado,
    badgeClass,
    lat: geo?.latitud  != null ? parseFloat(geo.latitud).toFixed(5)  : null,
    lng: geo?.longitud != null ? parseFloat(geo.longitud).toFixed(5) : null,
    dispositivo: geo?.dispositivo || '—',
    registrosCrudos: registros, // por si se necesita el detalle al exportar
  };
}

/* ═══════════════════════════════════════════════════
   KPIs — Tiempo Promedio y Eficiencia
   Ambos se calculan SOLO con datos reales (sesiones).
   ═══════════════════════════════════════════════════ */
function calcularKPIs(sesiones) {
  if (!sesiones || sesiones.length === 0) {
    document.getElementById('kpiTiempo').textContent       = '—';
    document.getElementById('kpiEficiencia').textContent   = todosLosRegistros.length || '—';
    return;
  }

  // ── Tiempo Promedio ──
  // Promedio de duracionMin SOLO de las sesiones que tuvieron 2+ registros
  // (las de 1 solo registro no tienen forma de calcular duración real).
  const sesionesConDuracion = sesiones.filter(s => s.duracionMin !== null);
  const tiempoProm = sesionesConDuracion.length
    ? Math.round(sesionesConDuracion.reduce((acc, s) => acc + s.duracionMin, 0) / sesionesConDuracion.length)
    : null;

  document.getElementById('kpiTiempo').textContent = tiempoProm !== null ? tiempoProm : '—';

  // ── Total de registros ──
  // Cantidad de registros de inventario en el rango filtrado
  // (cada registro = un producto contado, según la API oficial).
  document.getElementById('kpiEficiencia').textContent = todosLosRegistros.length;
}

/* ── TABLA — despacha según tabActivo ── */
function renderTabla() {
  if (tabActivo === 'detalle') {
    renderTablaDetalle();
  } else {
    renderTablaSesiones();
  }
}

function renderTablaSesiones() {
  const buscar    = document.getElementById('buscarOperario').value.toLowerCase();
  const filtrados = buscar
    ? sesionesActuales.filter(s =>
        (s.usuario   || '').toLowerCase().includes(buscar) ||
        (s.almacen   || '').toLowerCase().includes(buscar) ||
        String(s.idOperario || '').toLowerCase().includes(buscar)
      )
    : sesionesActuales;

  const inicio = (paginaActual - 1) * POR_PAGINA;
  const pagina = filtrados.slice(inicio, inicio + POR_PAGINA);
  const tbody  = document.getElementById('tablaBody');

  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr class="loading-row"><td colspan="6">No se encontraron registros</td></tr>';
    document.getElementById('totalRegistros').textContent = 'Sin registros';
    document.getElementById('paginacion').innerHTML = '';
    return;
  }

  const fmtHora = iso => iso
    ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false })
    : '—';

  tbody.innerHTML = pagina.map(s => {
    const tiempoTotal = s.duracionMin !== null
      ? `${s.duracionMin} min`
      : '<span title="Solo hay un registro en esta sesión; no se puede calcular el tiempo de permanencia." style="color:var(--color-texto-suave);cursor:help">—</span>';

    const geoTexto = (s.lat && s.lng)
      ? `${s.lat}, ${s.lng}<br><span style="color:var(--color-texto-suave);font-size:10px">${ppEscaparHTML(s.dispositivo)}</span>`
      : '—';

    return `<tr>
      <td class="td-id">${ppEscaparHTML(s.idOperario)}</td>
      <td class="td-nombre">${ppEscaparHTML(s.usuario)}</td>
      <td>${ppEscaparHTML(s.almacen)}</td>
      <td>${fmtHora(s.entrada)}</td>
      <td>${fmtHora(s.salida)}</td>
      <td>${tiempoTotal}</td>
    </tr>`;
  }).join('');

  document.getElementById('totalRegistros').textContent =
    `Mostrando ${inicio + 1}–${Math.min(inicio + POR_PAGINA, filtrados.length)} de ${filtrados.length} sesiones`;

  renderPaginacion(filtrados.length);
}

function renderTablaDetalle() {
  const buscar    = document.getElementById('buscarOperario').value.toLowerCase();
  const filtrados = buscar
    ? detalleActual.filter(r =>
        (r.usuarioCreacion || '').toLowerCase().includes(buscar) ||
        (r.dscProducto     || '').toLowerCase().includes(buscar) ||
        (r.idAlmacen       || '').toLowerCase().includes(buscar) ||
        (r.almacen         || '').toLowerCase().includes(buscar)
      )
    : detalleActual;

  const inicio = (paginaActual - 1) * POR_PAGINA;
  const pagina = filtrados.slice(inicio, inicio + POR_PAGINA);
  const tbody  = document.getElementById('tablaBody');

  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr class="loading-row"><td colspan="6">No se encontraron registros</td></tr>';
    document.getElementById('totalRegistros').textContent = 'Sin registros';
    document.getElementById('paginacion').innerHTML = '';
    return;
  }

  const fmtHora = iso => iso
    ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false })
    : '—';

  tbody.innerHTML = pagina.map(r => {
    return `<tr>
      <td class="td-nombre">${ppEscaparHTML(r.usuarioCreacion || '—')}</td>
      <td>${ppEscaparHTML(r.dscProducto || r.idProducto || '—')}</td>
      <td>${ppEscaparHTML(r.almacen || r.idAlmacen || '—')}</td>
      <td>${fmtHora(r.fechaCreacion)}</td>
      <td>${ppEscaparHTML(r.cantidad ?? '—')} ${ppEscaparHTML(r.idMedida || '')}</td>
      <td><strong>${r.tiempoEnAlmacenMin} min</strong></td>
    </tr>`;
  }).join('');

  document.getElementById('totalRegistros').textContent =
    `Mostrando ${inicio + 1}–${Math.min(inicio + POR_PAGINA, filtrados.length)} de ${filtrados.length} productos`;

  renderPaginacion(filtrados.length);
}

function renderPaginacion(total) {
  const totalPag = Math.ceil(total / POR_PAGINA);
  const cont = document.getElementById('paginacion');
  if (totalPag <= 1) { cont.innerHTML = ''; return; }

  let html = `<button class="pag-btn" onclick="irPagina(${paginaActual - 1})" ${paginaActual === 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = 1; i <= Math.min(totalPag, 5); i++) {
    html += `<button class="pag-btn ${i === paginaActual ? 'activo' : ''}" onclick="irPagina(${i})">${i}</button>`;
  }
  if (totalPag > 5) {
    html += `<span style="padding:0 4px;color:var(--color-texto-suave)">…</span>`;
    html += `<button class="pag-btn" onclick="irPagina(${totalPag})">${totalPag}</button>`;
  }
  html += `<button class="pag-btn" onclick="irPagina(${paginaActual + 1})" ${paginaActual === totalPag ? 'disabled' : ''}>›</button>`;
  cont.innerHTML = html;
}

function irPagina(n) {
  const fuente = tabActivo === 'detalle' ? detalleActual : sesionesActuales;
  const total  = Math.ceil(fuente.length / POR_PAGINA);
  if (n < 1 || n > total) return;
  paginaActual = n;
  renderTabla();
}

/* ── EXPORTAR — exporta la vista activa ── */
function exportarExcel() {
  if (tabActivo === 'detalle') {
    if (!detalleActual.length) { alert('No hay registros para exportar.'); return; }
    const headers = ['Operario','Producto','Almacén','Fecha/Hora','Cantidad','Medida','Tiempo en almacén (min)','Es primer registro','Es último registro'];
    const filas = detalleActual.map(r => [
      r.usuarioCreacion || '—',
      r.dscProducto || r.idProducto || '—',
      r.almacen || r.idAlmacen || '—',
      r.fechaCreacion || '',
      r.cantidad ?? '',
      r.idMedida || '',
      r.tiempoEnAlmacenMin,
      r.esPrimero ? 'Sí' : 'No',
      r.esUltimo  ? 'Sí' : 'No',
    ]);
    descargarCSV('detalle-por-producto.csv', headers, filas);
  } else {
    if (!sesionesActuales.length) { alert('No hay registros para exportar.'); return; }
    const headers = ['ID Operario','Nombre','Almacén','Entrada','Salida','Tiempo Total (min)','Productos Contados','Lat','Lng','Dispositivo','Estado'];
    const filas = sesionesActuales.map(s => [
      s.idOperario, s.usuario, s.almacen,
      s.entrada ?? '', s.salida ?? '',
      s.duracionMin ?? '',
      s.productos,
      s.lat ?? '', s.lng ?? '', s.dispositivo ?? '',
      s.estado
    ]);
    descargarCSV('reporte-permanencia.csv', headers, filas);
  }
}

function descargarCSV(nombreArchivo, headers, filas) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...filas].map(f => f.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombreArchivo;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── EVENTOS ── */
document.getElementById('buscarOperario').addEventListener('input', () => { paginaActual = 1; renderTabla(); });
document.getElementById('fechaInicio').addEventListener('change', cargarMovimientos);
document.getElementById('fechaFin').addEventListener('change', cargarMovimientos);
document.getElementById('selectorAlmacen').addEventListener('change', cargarMovimientos);
document.getElementById('btnExportar').addEventListener('click', exportarExcel);

/* ── INIT ── */
verificarAutenticacion();
cargarAlmacenes();
cargarMovimientos();

/* ═══════════════════════════════════════════════════════════════
   DROPDOWN DE ALMACÉN PERSONALIZADO
   Reemplaza el popup nativo del <select> (que el navegador dibuja
   con ancho incontrolable) por un panel propio que respeta el ancho
   y envuelve el texto. El <select> sigue existiendo oculto como
   fuente de datos y portador del value: al elegir una opción se
   sincroniza su value y se dispara su evento 'change', de modo que
   toda la lógica existente (cargarMovimientos) funciona sin cambios.
═══════════════════════════════════════════════════════════════ */
(function initDropdownAlmacen() {
  const cont    = document.getElementById('almacenDropdown');
  const trigger = document.getElementById('almacenTrigger');
  const label   = document.getElementById('almacenTriggerLabel');
  const panel   = document.getElementById('almacenPanel');
  const select  = document.getElementById('selectorAlmacen');
  if (!cont || !trigger || !panel || !select) return;

  function sincronizarLabel() {
    const opt = select.options[select.selectedIndex];
    label.textContent = opt ? opt.textContent : 'Todos los almacenes';
  }

  function renderOpciones() {
    panel.innerHTML = '';
    Array.from(select.options).forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = 'almacen-opt' + (i === select.selectedIndex ? ' seleccionado' : '');
      div.setAttribute('role', 'option');
      div.setAttribute('aria-selected', i === select.selectedIndex ? 'true' : 'false');
      div.textContent = opt.textContent;
      div.addEventListener('click', () => {
        if (select.selectedIndex !== i) {
          select.selectedIndex = i;
          select.dispatchEvent(new Event('change'));
        }
        sincronizarLabel();
        cerrar();
      });
      panel.appendChild(div);
    });
  }

  function abrir() {
    renderOpciones();
    panel.classList.add('abierto');
    trigger.setAttribute('aria-expanded', 'true');
    const sel = panel.querySelector('.almacen-opt.seleccionado');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  function cerrar() {
    panel.classList.remove('abierto');
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.contains('abierto') ? cerrar() : abrir();
  });

  document.addEventListener('click', (e) => {
    if (!cont.contains(e.target)) cerrar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrar();
  });

  sincronizarLabel();
})();
