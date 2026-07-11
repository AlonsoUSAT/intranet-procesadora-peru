'use strict';

/* ═══════════════════════════════════════════════════
   RESUMEN DE CONTEOS DE INVENTARIO — Procesadora Perú S.A.C.
   Consume EXCLUSIVAMENTE la API oficial vía api-config.js:
     GET /api/almacen/inventarios?...

   La toma de inventario se hace producto por producto. Este
   reporte agrupa esos registros en "conteos" (un operario en
   un almacén) y muestra, por cada uno: cuántos productos se
   contaron, la cantidad total, cuándo terminó y cuánto tomó.

   La lógica de agrupación está en js/conteos.js (compartida
   con el Panel de Acopio). El <script> de conteos.js debe
   cargarse ANTES que este archivo en el HTML.
   ═══════════════════════════════════════════════════ */

let conteosData = [];
let busquedaActiva = '';

async function cargarConteos() {
  try {
    const hoy = fechaHoyISO();

    // API OFICIAL: GET /api/almacen/inventarios
    const inventarios = await apiConsultarInventarios(null, null, hoy, hoy);
    const registros = inventarios || [];

    // Operarios que registraron hoy
    const operariosUnicos = new Set(
      registros.map(i => i.usuarioCreacion).filter(Boolean)
    );
    document.getElementById('statusOperarios').textContent =
      `${operariosUnicos.size} operarios con registro`;

    // Agrupar en conteos (lógica en js/conteos.js)
    conteosData = agruparConteos(registros);

    document.getElementById('statusAlertas').textContent =
      `${conteosData.length} conteos`;
    document.getElementById('statusRegistros').textContent =
      `${registros.length} registros hoy`;
    document.getElementById('statusSync').textContent = '● SINCRONIZADO';
    document.getElementById('statusSync').style.color = '';

    renderGrid();

  } catch (e) {
    console.error('[Conteos] Error:', e);
    document.getElementById('incidenciasGrid').innerHTML =
      '<div class="inc-vacio"><div class="inc-vacio-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>Error al cargar. Verificar conexión.</div>';
    document.getElementById('statusSync').textContent = 'SIN CONEXIÓN';
    document.getElementById('statusSync').style.color = '#DC2626';
  }
}

function renderGrid() {
  const filtrados = conteosData.filter(c => {
    if (!busquedaActiva) return true;
    return c.operario.toLowerCase().includes(busquedaActiva) ||
           c.almacen.toLowerCase().includes(busquedaActiva);
  });

  const grid = document.getElementById('incidenciasGrid');

  if (filtrados.length === 0) {
    grid.innerHTML = `
      <div class="inc-vacio">
        <div class="inc-vacio-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
        No hay conteos para mostrar
      </div>`;
    return;
  }

  grid.innerHTML = filtrados.map(c => `
    <div class="inc-card">
      <div class="inc-card-header">
        <span class="inc-tag tag-tiempo">${c.productosContados} registro${c.productosContados !== 1 ? 's' : ''}</span>
        <span class="inc-tiempo-rel">${formatearFecha(c.fin)}</span>
      </div>
      <div class="inc-titulo">${ppEscaparHTML(c.almacen)}</div>
      <div class="inc-operario">Operario: ${ppEscaparHTML(c.operario)}</div>
      <div class="inc-meta">
        <div class="inc-meta-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${c.cantidadTotal != null ? `${c.cantidadTotal} unid. total` : '—'}
        </div>
      </div>
    </div>`
  ).join('');
}

function formatearFecha(iso) {
  if (!iso || iso === '—') return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false });
}

/* ── EVENTOS ── */
document.getElementById('buscarInc').addEventListener('input', e => {
  busquedaActiva = e.target.value.toLowerCase();
  renderGrid();
});

document.getElementById('btnExportar').addEventListener('click', () => {
  if (!conteosData.length) { alert('No hay conteos para exportar.'); return; }

  const headers = ['Operario','Almacén','Sucursal','Productos contados','Cantidad total','Inicio','Fin','Duración (min)'];
  const filas = conteosData.map(c => [
    c.operario, c.almacen, c.sucursal, c.productosContados,
    c.cantidadTotal ?? '', c.inicio, c.fin, c.duracionMin
  ]);

  descargarCSV('resumen-conteos.csv', headers, filas);
});

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

/* ── INIT ── */
verificarAutenticacion();
cargarConteos();
setInterval(cargarConteos, 90_000);  // Cada 90 segundos
