'use strict';

/* ═══════════════════════════════════════════════════
   REPORTE PANEL — Procesadora Perú S.A.C.
   Las coordenadas de los usuarios vienen en auditClientInfo
   de cada registro de /api/almacen/inventarios
   ═══════════════════════════════════════════════════ */

/* ── MAPA ── */
let ultimosOperarios = [];
let ultimasIncidencias = [];

const mapa = L.map('mapa', {
  center: [-6.7011, -79.9069],
  zoom: 13,
  zoomControl: true,
  preferCanvas: true,
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(mapa);

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const marcadores = new Map();

/* ════════════════════════════════════════════════════
   CARGAR DATOS desde /api/almacen/inventarios
   ════════════════════════════════════════════════════ */
async function cargarDatos() {
  try {
    const hoy = fechaHoyISO();
    const inventarios = await apiConsultarInventarios(null, null, hoy, hoy);

    /* ── Operarios únicos: último registro por usuario que tenga GPS ── */
    const mapaUsuarios = new Map();
    (inventarios || []).forEach(inv => {
      const geo = inv.auditClientInfo;
      if (!geo || geo.latitud == null || geo.longitud == null) return;

      const clave = inv.usuarioCreacion || 'DESCONOCIDO';
      const existente = mapaUsuarios.get(clave);
      if (!existente || new Date(inv.fechaCreacion) > new Date(existente.fechaCreacion)) {
        mapaUsuarios.set(clave, {
          usuario: inv.usuarioCreacion || '—',
          producto: inv.producto || '—',
          almacen: inv.almacen || '—',
          cantidad: inv.cantidad,
          unidadMedida: inv.unidadMedida || '—',
          fechaCreacion: inv.fechaCreacion,
          lat: parseFloat(geo.latitud),
          lng: parseFloat(geo.longitud),
          dispositivo: geo.dispositivo || '—',
          ip: geo.ip || '—',
        });
      }
    });
    const operarios = Array.from(mapaUsuarios.values());
    ultimosOperarios = operarios;

    /* ── KPIs ── */
    document.getElementById('kpiOperarios').textContent = operarios.length;
    document.getElementById('kpiOperarios').classList.remove('kpi-loading');

    /* ── KPI Productos contados (total de registros del día) ── */
    document.getElementById('kpiDesviaciones').textContent = (inventarios || []).length;
    document.getElementById('kpiDesviaciones').classList.remove('kpi-loading');

    /* ── Status bar ── */
    document.getElementById('statusOperarios').textContent = `${operarios.length} operarios con registro`;
    document.getElementById('statusRegistros').textContent = `${(inventarios || []).length} registros hoy`;

    /* ── Marcadores en el mapa ── */
    const idsActuales = new Set(operarios.map(o => o.usuario));
    for (const [id, m] of marcadores) {
      if (!idsActuales.has(id)) { mapa.removeLayer(m); marcadores.delete(id); }
    }

    operarios.forEach(op => {
      const pos = [op.lat, op.lng];
      const fechaFmt = op.fechaCreacion
        ? new Date(op.fechaCreacion).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false })
        : '—';
      const popup = `
        <div class="popup-operario">
          <div class="popup-nombre"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>${ppEscaparHTML(op.usuario)}</div>
          <div class="popup-fila"><span class="popup-clave">Producto</span><span class="popup-valor">${ppEscaparHTML(op.producto)}</span></div>
          <div class="popup-fila"><span class="popup-clave">Cantidad</span><span class="popup-valor">${op.cantidad != null ? ppEscaparHTML(op.cantidad + ' ' + op.unidadMedida) : '—'}</span></div>
          <div class="popup-fila"><span class="popup-clave">Almacén</span><span class="popup-valor">${ppEscaparHTML(op.almacen)}</span></div>
          <div class="popup-fila"><span class="popup-clave">Dispositivo</span><span class="popup-valor">${ppEscaparHTML(op.dispositivo)}</span></div>
          <div class="popup-fila"><span class="popup-clave">IP</span><span class="popup-valor">${ppEscaparHTML(op.ip)}</span></div>
          <div class="popup-fila"><span class="popup-clave">Actividad</span><span class="popup-valor">${fechaFmt}</span></div>
          <div class="popup-fila"><span class="popup-clave">Lat/Lng</span><span class="popup-valor">${op.lat.toFixed(6)}, ${op.lng.toFixed(6)}</span></div>
        </div>`;

      if (marcadores.has(op.usuario)) {
        marcadores.get(op.usuario).setLatLng(pos).setPopupContent(popup);
      } else {
        const m = L.marker(pos).addTo(mapa).bindPopup(popup, { maxWidth: 280 });
        marcadores.set(op.usuario, m);
      }
    });

    /* ── Si hay operarios, centrar mapa en el primero ── */
    if (operarios.length > 0 && marcadores.size > 0) {
      const grupo = L.featureGroup(Array.from(marcadores.values()));
      mapa.fitBounds(grupo.getBounds().pad(0.2));
    }

    document.getElementById('statusSync').textContent = '● SINCRONIZADO';
    document.getElementById('statusSync').style.color = '';

  } catch (e) {
    console.error('[Panel] Error:', e);
    document.getElementById('statusSync').textContent = 'SIN CONEXIÓN';
    document.getElementById('statusSync').style.color = '#DC2626';
  }
}

/* ════════════════════════════════════════════════════
   ÚLTIMOS CONTEOS — usa la agrupación compartida
   (js/conteos.js). Muestra los conteos de inventario más
   recientes del día (operario + almacén), sin alertas.
   ════════════════════════════════════════════════════ */
async function cargarIncidencias() {
  try {
    const hoy = fechaHoyISO();
    const inventarios = await apiConsultarInventarios(null, null, hoy, hoy);
    const registros = inventarios || [];

    // Agrupar registros en conteos (lógica compartida)
    const conteos = agruparConteos(registros);
    ultimasIncidencias = conteos;

    // Badge: cantidad de conteos del día
    document.getElementById('badgeNuevas').textContent = `${conteos.length} HOY`;
    document.getElementById('statusAlertas').textContent = `${conteos.length} conteos`;

    const lista = document.getElementById('listaIncidencias');
    if (conteos.length === 0) {
      lista.innerHTML = '<div style="color:var(--color-texto-suave);font-size:12px;text-align:center;padding:20px 0">Sin conteos registrados hoy</div>';
      return;
    }

    const fmtFecha = iso => iso && iso !== '—'
      ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false })
      : '—';

    lista.innerHTML = conteos.slice(0, 3).map(c => `
      <div class="incidencia-item">
        <span class="inc-tag tag-tiempo">${c.productosContados} registro${c.productosContados !== 1 ? 's' : ''}</span>
        <span class="inc-tiempo">${fmtFecha(c.fin)}</span>
        <div class="inc-titulo">${ppEscaparHTML(c.almacen)}</div>
        <div class="inc-operario">Operario: ${ppEscaparHTML(c.operario)} · ${c.duracionMin} min</div>
      </div>`).join('');

  } catch (e) { console.error('[Panel] Incidencias:', e); }
}


/* ── ACCIONES ── */
document.getElementById('btnExportar').addEventListener('click', () => {
  if (!ultimosOperarios.length && !ultimasIncidencias.length) {
    alert('No hay datos para exportar.'); 
    return;
  }

  if (ultimosOperarios.length) {
    const headersOp = ['Usuario','Producto','Almacén','Cantidad','Unidad','Fecha','Lat','Lng','Dispositivo','IP'];
    const filasOp = ultimosOperarios.map(o => [
      o.usuario, o.producto, o.almacen, o.cantidad ?? '', o.unidadMedida,
      o.fechaCreacion, o.lat, o.lng, o.dispositivo, o.ip
    ]);
    descargarCSV('panel-operarios.csv', headersOp, filasOp);
  }

  if (ultimasIncidencias.length) {
    const headersInc = ['Operario','Almacén','Productos contados','Cantidad total','Inicio','Fin','Duración (min)'];
    const filasInc = ultimasIncidencias.map(c => [
      c.operario, c.almacen, c.productosContados, c.cantidadTotal ?? '', c.inicio, c.fin, c.duracionMin
    ]);
    descargarCSV('panel-conteos.csv', headersInc, filasInc);
  }
});

function descargarCSV(nombreArchivo, headers, filas) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...filas].map(f => f.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; 
  a.download = nombreArchivo;
  document.body.appendChild(a); 
  a.click(); 
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── INIT ── */
verificarAutenticacion();
cargarDatos();
cargarIncidencias();
setInterval(cargarDatos, API_CONFIG.INTERVALO_POLLING_MS);
setInterval(cargarIncidencias, 90_000);  // Cada 90 segundos (antes 30s)