
'use strict';

/* ═══════════════════════════════════════════════════
   MONITOR GIS — Procesadora Perú S.A.C.
   ═══════════════════════════════════════════════════
   Consume EXCLUSIVAMENTE las APIs oficiales vía
   api-config.js (fetchConAuth / apiConsultarInventarios).
   ═══════════════════════════════════════════════════ */

const CONFIG = {
  MAPA_CENTRO: [-6.7011, -79.9069],
  MAPA_ZOOM: 13,
};

let mapa = null;

/** Marcador y círculo de precisión de la geolocalización del usuario */
let marcadorUsuario = null;
let circuloPrecision = null;
let ubicacionUsuario = null;
let watchIdGeo = null;

// ═══════════════════════════════════════════════════
// 1. INICIALIZACIÓN DEL MAPA
// ═══════════════════════════════════════════════════

function configurarIconosLeaflet() {
  // Los marcadores usan un pin SVG embebido (no dependen de archivos PNG externos)
}

/**
 * Pin de mapa clásico con figura de operario, dibujado como SVG embebido.
 * Al no usar imágenes externas, el operario SIEMPRE se muestra con su icono.
 */
function crearIconoOperario() {
  const svg = `
    <svg width="34" height="46" viewBox="0 0 34 46" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 0C7.6 0 0 7.6 0 17c0 12 17 29 17 29s17-17 17-29C34 7.6 26.4 0 17 0z"
            fill="#F26522" stroke="#ffffff" stroke-width="2"/>
      <circle cx="17" cy="15" r="5" fill="#ffffff"/>
      <path d="M8 30c0-5 4-8 9-8s9 3 9 8z" fill="#ffffff"/>
    </svg>`;
  return L.divIcon({
    className: 'icono-operario',
    html: svg,
    iconSize: [34, 46],
    iconAnchor: [17, 46],
    popupAnchor: [0, -42],
  });
}

function iniciarMapa() {
  configurarIconosLeaflet();

  mapa = L.map('mapa', {
    center: CONFIG.MAPA_CENTRO,
    zoom: CONFIG.MAPA_ZOOM,
    zoomControl: true,
    preferCanvas: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapa);

  document.getElementById('btnCentrar').addEventListener('click', () => {
    if (ubicacionUsuario) {
      mapa.setView(ubicacionUsuario, 16, { animate: true });
    } else {
      mapa.setView(CONFIG.MAPA_CENTRO, CONFIG.MAPA_ZOOM);
    }
  });
}

// ═══════════════════════════════════════════════════
// 2. GEOLOCALIZACIÓN DEL USUARIO
// ═══════════════════════════════════════════════════

function crearIconoUsuario() {
  return L.divIcon({
    className: 'marcador-usuario-contenedor',
    html: `
      <div class="marcador-usuario-pulso"></div>
      <div class="marcador-usuario-punto"></div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function iniciarGeolocalizacion() {
  if (!navigator.geolocation) {
    mostrarToast('Tu navegador no soporta geolocalización', 'error');
    return;
  }

  mostrarToast('Obteniendo tu ubicación…', 'info');

  watchIdGeo = navigator.geolocation.watchPosition(
    (posicion) => {
      const { latitude, longitude, accuracy } = posicion.coords;
      ubicacionUsuario = [latitude, longitude];

      if (!marcadorUsuario) {
        marcadorUsuario = L.marker(ubicacionUsuario, {
          icon: crearIconoUsuario(),
          zIndexOffset: 9999,
        })
          .addTo(mapa)
          .bindPopup(construirPopupUsuario(latitude, longitude, accuracy), { maxWidth: 260 });

        circuloPrecision = L.circle(ubicacionUsuario, {
          radius: accuracy,
          color: '#3b82f6',
          fillColor: '#3b82f6',
          fillOpacity: 0.08,
          weight: 1,
          dashArray: '4 4',
        }).addTo(mapa);

        mapa.setView(ubicacionUsuario, 16, { animate: true });
        mostrarToast('Ubicación detectada', 'exito', 3000);
      } else {
        marcadorUsuario.setLatLng(ubicacionUsuario);
        circuloPrecision.setLatLng(ubicacionUsuario);
        circuloPrecision.setRadius(accuracy);
      }

      marcadorUsuario.setPopupContent(construirPopupUsuario(latitude, longitude, accuracy));
    },
    (error) => {
      console.warn('[Monitor GIS] Error de geolocalización:', error.message);
      switch (error.code) {
        case error.PERMISSION_DENIED:
          mostrarToast('Permiso de ubicación denegado', 'error'); break;
        case error.POSITION_UNAVAILABLE:
          mostrarToast('Ubicación no disponible', 'error'); break;
        case error.TIMEOUT:
          mostrarToast('Tiempo de espera agotado para ubicación', 'error'); break;
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

function construirPopupUsuario(lat, lng, accuracy) {
  return `
    <div class="popup-operario">
      <div class="popup-nombre"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Tu ubicación</div>
      <div class="popup-fila">
        <span class="popup-clave">Lat / Lng</span>
        <span class="popup-valor">${lat.toFixed(6)}, ${lng.toFixed(6)}</span>
      </div>
      <div class="popup-fila">
        <span class="popup-clave">Precisión</span>
        <span class="popup-valor">± ${Math.round(accuracy)} m</span>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════
// 3. MARCADORES DE OPERARIOS (desde API oficial)
// ═══════════════════════════════════════════════════

const marcadoresOperarios = new Map();

/**
 * Transforma los datos crudos de /api/almacen/inventarios
 * en una lista de "operarios" únicos (último registro por usuario).
 */
function extraerOperariosDeInventarios(inventarios) {
  if (!inventarios || !Array.isArray(inventarios)) return [];

  const mapaUsuarios = new Map();

  inventarios.forEach(inv => {
    // Las coordenadas vienen en auditClientInfo (captura GPS del celular)
    const geo = inv.auditClientInfo;
    if (!geo || geo.latitud == null || geo.longitud == null) return;

    const clave = inv.usuarioCreacion || 'DESCONOCIDO';
    const existente = mapaUsuarios.get(clave);

    // Quedarse con el registro más reciente por usuario
    if (!existente || new Date(inv.fechaCreacion) > new Date(existente.fechaCreacion)) {
      mapaUsuarios.set(clave, {
        idCliente: clave,
        nombres: inv.usuarioCreacion || 'Sin nombre',
        latitud: parseFloat(geo.latitud),
        longitud: parseFloat(geo.longitud),
        dispositivo: geo.dispositivo || '—',
        ip: geo.ip || '—',
        producto: inv.producto || '—',
        sucursal: inv.sucursal || '—',
        almacen: inv.almacen || '—',
        cantidad: inv.cantidad,
        unidadMedida: inv.unidadMedida || '—',
        fechaCreacion: inv.fechaCreacion,
      });
    }
  });

  return Array.from(mapaUsuarios.values());
}

function actualizarMarcadoresOperarios(operarios) {
  const idsActuales = new Set(operarios.map(op => op.idCliente));

  for (const [id, marcador] of marcadoresOperarios) {
    if (!idsActuales.has(id)) {
      mapa.removeLayer(marcador);
      marcadoresOperarios.delete(id);
    }
  }

  operarios.forEach(operario => {
    const { idCliente, latitud, longitud } = operario;
    if (!latitud || !longitud) return;

    const posicion = [parseFloat(latitud), parseFloat(longitud)];

    if (marcadoresOperarios.has(idCliente)) {
      marcadoresOperarios.get(idCliente).setLatLng(posicion);
    } else {
      const marcador = L.marker(posicion, { icon: crearIconoOperario() })
        .addTo(mapa)
        .bindPopup(construirPopupOperario(operario), { maxWidth: 260 });

      marcador.on('click', () => destacarOperarioEnPanel(idCliente));
      marcadoresOperarios.set(idCliente, marcador);
    }

    marcadoresOperarios.get(idCliente).setPopupContent(construirPopupOperario(operario));
  });
}

function construirPopupOperario(operario) {
  const { nombres, dispositivo, ip, latitud, longitud, producto, sucursal, almacen, cantidad, unidadMedida, fechaCreacion } = operario;
  const fechaFmt = fechaCreacion
    ? new Date(fechaCreacion).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false })
    : '—';
  return `
    <div class="popup-operario">
      <div class="popup-nombre"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>${escaparHTML(nombres || 'Sin nombre')}</div>
      <div class="popup-fila">
        <span class="popup-clave">Producto</span>
        <span class="popup-valor">${escaparHTML(producto || '—')}</span>
      </div>
      <div class="popup-fila">
        <span class="popup-clave">Cantidad</span>
        <span class="popup-valor">${cantidad != null ? cantidad + ' ' + unidadMedida : '—'}</span>
      </div>
      <div class="popup-fila">
        <span class="popup-clave">Almacén</span>
        <span class="popup-valor">${escaparHTML(almacen || '—')}</span>
      </div>
      <div class="popup-fila">
        <span class="popup-clave">Dispositivo</span>
        <span class="popup-valor">${escaparHTML(dispositivo || '—')}</span>
      </div>
      <div class="popup-fila">
        <span class="popup-clave">IP</span>
        <span class="popup-valor">${escaparHTML(ip || '—')}</span>
      </div>
      <div class="popup-fila">
        <span class="popup-clave">Última actividad</span>
        <span class="popup-valor">${fechaFmt}</span>
      </div>
      <div class="popup-fila">
        <span class="popup-clave">Lat / Lng</span>
        <span class="popup-valor">${latitud.toFixed(6)}, ${longitud.toFixed(6)}</span>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════
// 4. PANEL FLOTANTE
// ═══════════════════════════════════════════════════

let todosLosOperarios = [];

function actualizarListaOperarios(operarios) {
  todosLosOperarios = operarios;
  const termino = document.getElementById('filtroOperario').value.toLowerCase();
  const filtrados = termino
    ? operarios.filter(op => (op.nombres || '').toLowerCase().includes(termino))
    : operarios;
  renderizarItemsOperarios(filtrados);
  document.getElementById('contadorOperarios').textContent = operarios.length;
}

function renderizarItemsOperarios(operarios) {
  const lista = document.getElementById('listaOperarios');
  lista.innerHTML = '';

  if (operarios.length === 0) {
    lista.innerHTML = '<li class="operario-vacio">No se encontraron operarios</li>';
    return;
  }

  operarios.forEach(operario => {
    const { idCliente, nombres, producto, dispositivo, fechaCreacion } = operario;
    const iniciales = obtenerIniciales(nombres);
    const li = document.createElement('li');
    li.className = 'operario-item';
    li.dataset.id = idCliente;
    li.innerHTML = `
      <div class="operario-avatar">${iniciales}</div>
      <div class="operario-info">
        <span class="operario-nombre">${escaparHTML(nombres || 'Sin nombre')}</span>
        <span class="operario-meta">${escaparHTML(producto || '—')} · ${escaparHTML(dispositivo || '—')}</span>
        <span class="operario-tiempo">${tiempoRelativo(fechaCreacion)}</span>
      </div>
    `;
    li.addEventListener('click', () => {
      const marcador = marcadoresOperarios.get(idCliente);
      if (marcador) {
        mapa.setView(marcador.getLatLng(), 16, { animate: true });
        marcador.openPopup();
      }
    });
    lista.appendChild(li);
  });
}

function destacarOperarioEnPanel(idCliente) {
  document.querySelectorAll('.operario-item').forEach(item => item.classList.remove('activo'));
  const itemObjetivo = document.querySelector(`.operario-item[data-id="${idCliente}"]`);
  if (itemObjetivo) {
    itemObjetivo.classList.add('activo');
    itemObjetivo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}


// ═══════════════════════════════════════════════════
// 6. POLLING — Usa EXCLUSIVAMENTE API oficial
//    GET /api/almacen/inventarios
// ═══════════════════════════════════════════════════

let idIntervalo = null;
let cuentaRegresivaVal = Math.round(API_CONFIG.INTERVALO_POLLING_MS / 1000);
let idCuentaRegresiva = null;

/**
 * Obtiene datos de la API oficial de Procesadora Perú.
 * Endpoint: GET /api/almacen/inventarios?fechaInicio=HOY&fechaFin=HOY
 */
async function obtenerDatos() {
  try {
    const hoy = fechaHoyISO();

    // Llamada EXCLUSIVA a la API oficial
    const inventarios = await apiConsultarInventarios(null, null, hoy, hoy);

    // Extraer operarios únicos (último registro por usuario)
    const operarios = extraerOperariosDeInventarios(inventarios);

    // Actualizar mapa
    actualizarMarcadoresOperarios(operarios);

    // Actualizar panel
    actualizarListaOperarios(operarios);

    // Indicador visual
    setEstadoConexion('conectado',
      `${operarios.length} operario${operarios.length !== 1 ? 's' : ''} con registro hoy`
    );

  } catch (error) {
    console.error('[Monitor GIS] Error al obtener datos:', error);
    setEstadoConexion('error', 'Sin conexión al servidor');
    mostrarToast('No se pudo conectar a la API. Reintentando...', 'error');
  }
}

function iniciarPolling() {
  obtenerDatos();
  iniciarCuentaRegresiva();
  idIntervalo = setInterval(() => {
    obtenerDatos();
    reiniciarCuentaRegresiva();
  }, API_CONFIG.INTERVALO_POLLING_MS);
}

function iniciarCuentaRegresiva() {
  cuentaRegresivaVal = Math.round(API_CONFIG.INTERVALO_POLLING_MS / 1000);
  actualizarTextoCuenta();
  idCuentaRegresiva = setInterval(() => {
    cuentaRegresivaVal--;
    if (cuentaRegresivaVal < 0) cuentaRegresivaVal = Math.round(API_CONFIG.INTERVALO_POLLING_MS / 1000);
    actualizarTextoCuenta();
  }, 1000);
}

function reiniciarCuentaRegresiva() {
  cuentaRegresivaVal = Math.round(API_CONFIG.INTERVALO_POLLING_MS / 1000);
  actualizarTextoCuenta();
  const barra = document.getElementById('refrescoBarra');
  barra.style.animation = 'none';
  barra.offsetHeight;
  barra.style.animation = '';
}

function actualizarTextoCuenta() {
  const el = document.getElementById('cuentaRegresiva');
  if (el) el.textContent = cuentaRegresivaVal;
}

// ═══════════════════════════════════════════════════
// 7. SIDEBAR Y UI GENERAL
// ═══════════════════════════════════════════════════

function iniciarUI() {
  const sidebar = document.getElementById('sidebar');

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('activo'));
      item.classList.add('activo');
    });
  });

  document.getElementById('filtroOperario').addEventListener('input', () => {
    actualizarListaOperarios(todosLosOperarios);
  });

  document.getElementById('btnRefrescar').addEventListener('click', () => {
    obtenerDatos();
    reiniciarCuentaRegresiva();
    mostrarToast('Actualizando datos...', 'info');
  });

  actualizarFechaTopbar();
  setInterval(actualizarFechaTopbar, 60_000);
}

function actualizarFechaTopbar() {
  const el = document.getElementById('topbarFecha');
  if (!el) return;
  const ahora = new Date();
  el.textContent = ahora.toLocaleDateString('es-PE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima',
  });
}

function setEstadoConexion(estado, texto) {
  const dot = document.getElementById('estadoDot');
  const textoEl = document.getElementById('estadoTexto');
  dot.className = `estado-dot ${estado}`;
  textoEl.textContent = texto;
}

// ═══════════════════════════════════════════════════
// 8. UTILIDADES
// ═══════════════════════════════════════════════════

function escaparHTML(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

function obtenerIniciales(nombre) {
  if (!nombre) return '??';
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

/**
 * Devuelve un texto tipo "hace 5 min" / "hace 2 h" a partir de
 * la fecha del último registro del operario. Ayuda al supervisor
 * a saber de un vistazo si el dato es reciente o ya es antiguo.
 */
function tiempoRelativo(fechaISO) {
  if (!fechaISO) return 'Sin hora de registro';
  const fecha = new Date(fechaISO);
  if (isNaN(fecha.getTime())) return 'Sin hora de registro';

  const minutos = Math.round((Date.now() - fecha.getTime()) / 60000);
  if (minutos < 1) return 'Último registro: ahora mismo';
  if (minutos < 60) return `Último registro: hace ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  const restoMin = minutos % 60;
  if (horas < 24) {
    return restoMin > 0
      ? `Último registro: hace ${horas} h ${restoMin} min`
      : `Último registro: hace ${horas} h`;
  }
  return 'Último registro: hace más de un día';
}

function mostrarToast(mensaje, tipo = 'info', duracion = 3000) {
  let contenedor = document.querySelector('.toast-contenedor');
  if (!contenedor) {
    contenedor = document.createElement('div');
    contenedor.className = 'toast-contenedor';
    document.body.appendChild(contenedor);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = mensaje;
  contenedor.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
  }, duracion);
}

// ═══════════════════════════════════════════════════
// PUNTO DE ENTRADA
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  verificarAutenticacion(); // Redirige a login si no hay sesión
  iniciarUI();
  iniciarMapa();
  iniciarGeolocalizacion();
  iniciarPolling();
});
