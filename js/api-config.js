
'use strict';

/**
 * Configuración global de las APIs oficiales de Procesadora Perú.
 * Todos los endpoints apuntan EXCLUSIVAMENTE a la API oficial.
 */
const API_CONFIG = {

  /* ── Base URL ─────────────────────────────────────
     Proxy CORS para desarrollo.
     En producción se reemplaza por la URL directa.
  ──────────────────────────────────────────────── */
  BASE_URL: 'https://api.procesadoraperu.com',

  /* ── Endpoints Oficiales ──────────────────────── */
  ENDPOINTS: {
    // Auth
    AUTH_LOGIN:          '/api/auth/login',
    AUTH_REFRESH:        '/api/auth/refresh-token',
    AUTH_LOGOUT:         '/api/auth/logout',

    // Maestros (Nisira)
    SUCURSALES:          '/api/nisira/sucursales',
    ALMACENES_BY_SUC:    '/api/nisira/sucursales/{idSucursal}/almacenes',
    PRODUCTOS:           '/api/nisira/productos',
    PRODUCTO_STOCK:      '/api/nisira/producto-stock',
    INVENTARIOS:         '/api/almacen/inventarios',       // GET (consultar) y POST (registrar)
  },

  /* ── Polling ────────────────────────────────────── */
  INTERVALO_POLLING_MS: 15_000,

  /* ── Token auto-refresh cada 10 min ──────────── */
  INTERVALO_REFRESH_MS: 10 * 60 * 1000,
};


/* ═══════════════════════════════════════════════════
   GESTIÓN DE SESIÓN (sessionStorage)
   ═══════════════════════════════════════════════════ */

const SesionAuth = {

  /** Guarda tokens después de login exitoso */
  guardar(accessToken, refreshToken, username) {
    sessionStorage.setItem('pp_accessToken',  accessToken);
    sessionStorage.setItem('pp_refreshToken', refreshToken);
    sessionStorage.setItem('pp_username',     username);
  },

  /** Obtiene el access token actual */
  getToken() {
    return sessionStorage.getItem('pp_accessToken');
  },

  /** Obtiene el refresh token */
  getRefreshToken() {
    return sessionStorage.getItem('pp_refreshToken');
  },

  /** Obtiene el username */
  getUsername() {
    return sessionStorage.getItem('pp_username');
  },

  /** ¿Hay sesión activa? */
  estaAutenticado() {
    return !!sessionStorage.getItem('pp_accessToken');
  },

  /** Actualiza solo el access token (después de refresh) */
  actualizarToken(nuevoAccessToken) {
    sessionStorage.setItem('pp_accessToken', nuevoAccessToken);
  },

  /** Limpia toda la sesión */
  limpiar() {
    sessionStorage.removeItem('pp_accessToken');
    sessionStorage.removeItem('pp_refreshToken');
    sessionStorage.removeItem('pp_username');
  },
};


/* ═══════════════════════════════════════════════════
   FETCH CON AUTENTICACIÓN
   ═══════════════════════════════════════════════════
   Wrapper de fetch() que:
   1. Agrega Authorization: Bearer <token>
   2. Parsea la respuesta envuelta {success, data, errors}
   3. Si el token expira, intenta refresh automático
   ═══════════════════════════════════════════════════ */

/**
 * Realiza una petición autenticada a la API oficial.
 *
 * @param {string} endpoint  - Ruta relativa (ej: '/api/almacen/inventarios')
 * @param {object} opciones  - Opciones extra de fetch (method, body, etc.)
 * @returns {Promise<any>}   - Contenido del campo `data` de la respuesta
 */
async function fetchConAuth(endpoint, opciones = {}) {
  const token = SesionAuth.getToken();

  if (!token) {
    console.warn('[API] Sin token. Redirigiendo a login...');
    window.location.href = 'loginIntranet.html';
    throw new Error('No autenticado');
  }

  // Use direct URL for authentication endpoints; proxy for others
  
  const url = `${API_CONFIG.BASE_URL}${endpoint}`;

  const headers = {
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'Authorization': `Bearer ${token}`,
    ...(opciones.headers || {}),
  };

  const config = { ...opciones, headers };

  let respuesta = await fetch(url, config);

  // Si 401 → intentar refresh del token
  if (respuesta.status === 401) {
    console.info('[API] Token expirado. Intentando refresh...');
    const refreshOk = await intentarRefreshToken();

    if (refreshOk) {
      // Reintentar con el nuevo token
      headers['Authorization'] = `Bearer ${SesionAuth.getToken()}`;
      respuesta = await fetch(url, { ...opciones, headers });
    } else {
      SesionAuth.limpiar();
      window.location.href = 'loginIntranet.html';
      throw new Error('Sesión expirada');
    }
  }

  if (!respuesta.ok) {
    throw new Error(`Error ${respuesta.status}: ${respuesta.statusText}`);
  }

  // Manejar respuestas vacías (ej: POST inventario devuelve 201 sin cuerpo)
  const texto = await respuesta.text();
  if (!texto || texto.trim() === '') {
    return null;
  }

  const json = JSON.parse(texto);

  // Las APIs de datos envuelven en { success, data, errors, traceId }
  // Las APIs de auth devuelven tokens directamente en la raíz (sin .data)
  if (json.success === false) {
    throw new Error(json.message || json.errors || 'Error de API');
  }

  // Si tiene wrapper .data → devolver .data
  // Si NO tiene wrapper (ej: auth) → devolver json completo
  return ('data' in json) ? json.data : json;
}

/**
 * Intenta refrescar el access token usando el refresh token.
 * @returns {Promise<boolean>} true si tuvo éxito
 */
async function intentarRefreshToken() {
  const refreshToken = SesionAuth.getRefreshToken();
  if (!refreshToken) return false;

  try {
    const refreshUrl = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.AUTH_REFRESH}`;
    const res = await fetch(refreshUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refreshToken }),
    });

    if (!res.ok) return false;

    const json = await res.json();
    const nuevoToken = json.accessToken || (json.data && json.data.accessToken);

    if (nuevoToken) {
      SesionAuth.actualizarToken(nuevoToken);
      console.info('[API] Token refrescado correctamente.');
      return true;
    }
    return false;
  } catch (e) {
    console.error('[API] Error al refrescar token:', e);
    return false;
  }
}


/* ═══════════════════════════════════════════════════
   HELPERS DE ENDPOINTS
   Funciones utilitarias para construir URLs con params
   ═══════════════════════════════════════════════════ */

/**
 * Obtiene la lista de sucursales.
 * GET /api/nisira/sucursales
 */
function apiGetSucursales() {
  return fetchConAuth(API_CONFIG.ENDPOINTS.SUCURSALES);
}

/**
 * Obtiene almacenes de una sucursal.
 * GET /api/nisira/sucursales/{idSucursal}/almacenes
 */
function apiGetAlmacenes(idSucursal) {
  const ep = API_CONFIG.ENDPOINTS.ALMACENES_BY_SUC.replace('{idSucursal}', idSucursal);
  return fetchConAuth(ep);
}

/**
 * Obtiene productos filtrados.
 * GET /api/nisira/productos?idGrupoPro=X&idSubGrupoPro=Y
 */
function apiGetProductos(idGrupo, idSubgrupo) {
  const params = new URLSearchParams();
  if (idGrupo)    params.set('idGrupoPro', idGrupo);
  if (idSubgrupo) params.set('idSubGrupoPro', idSubgrupo);
  return fetchConAuth(`${API_CONFIG.ENDPOINTS.PRODUCTOS}?${params}`);
}

/**
 * Obtiene stock de un producto por sucursal y almacén.
 * POST /api/nisira/producto-stock
 * Body: { idSucursal, idAlmacen, idProducto }
 */
function apiGetProductoStock(idSucursal, idAlmacen, idProducto) {
  return fetchConAuth(API_CONFIG.ENDPOINTS.PRODUCTO_STOCK, {
    method: 'POST',
    body: JSON.stringify({ idSucursal, idAlmacen, idProducto }),
  });
}

/**
 * Consulta inventarios por sucursal, almacén y rango de fechas.
 * GET /api/almacen/inventarios?idSucursal=X&idAlmacen=Y&fechaInicio=X&fechaFin=Y
 */
function apiConsultarInventarios(idSucursal, idAlmacen, fechaInicio, fechaFin) {
  const params = new URLSearchParams();
  if (idSucursal)  params.set('idSucursal', idSucursal);
  if (idAlmacen)   params.set('idAlmacen', idAlmacen);
  if (fechaInicio) params.set('fechaInicio', fechaInicio);
  if (fechaFin)    params.set('fechaFin', fechaFin);
  return fetchConAuth(`${API_CONFIG.ENDPOINTS.INVENTARIOS}?${params}`);
}

/**
 * Registra un nuevo inventario.
 * POST /api/almacen/inventarios
 * Responde 201 Created (puede tener cuerpo vacío)
 */
async function apiRegistrarInventario(datosInventario) {
  const token = SesionAuth.getToken();
  if (!token) {
    window.location.href = 'loginIntranet.html';
    throw new Error('No autenticado');
  }

  const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.INVENTARIOS}`;
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(datosInventario),
  });

  if (!respuesta.ok) {
    throw new Error(`Error ${respuesta.status}: ${respuesta.statusText}`);
  }

  // La API puede responder 201 sin cuerpo (Call<Void> en móvil)
  const texto = await respuesta.text();
  if (!texto || texto.trim() === '') {
    return null; // Registro exitoso, sin datos de retorno
  }

  try {
    const json = JSON.parse(texto);
    return ('data' in json) ? json.data : json;
  } catch (e) {
    return null; // Body no era JSON, pero el registro fue exitoso (201)
  }
}


/* ═══════════════════════════════════════════════════
   GUARD DE AUTENTICACIÓN
   Redirige automáticamente a login si no hay sesión.
   Se ejecuta al cargar este script en páginas protegidas.
   ═══════════════════════════════════════════════════ */

/**
 * Llama a esta función al inicio de cada página protegida
 * para verificar que exista sesión activa.
 */
function verificarAutenticacion() {
  if (!SesionAuth.estaAutenticado()) {
    console.warn('[Auth] Sin sesión activa. Redirigiendo a login...');
    window.location.href = 'loginIntranet.html';
  }
}


/* ═══════════════════════════════════════════════════
   UTILIDAD: Fecha de hoy formateada YYYY-MM-DD
   ═══════════════════════════════════════════════════ */

function fechaHoyISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

function fechaAyerISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}


/* ═══════════════════════════════════════════════════
   UTILIDAD: Escapar HTML (prevención de XSS)
   Convierte caracteres especiales para que cualquier dato
   de la API se muestre como texto y no se interprete como
   código. Disponible para todas las páginas que cargan
   este archivo.
   ═══════════════════════════════════════════════════ */

function ppEscaparHTML(valor) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(valor == null ? '' : valor)));
  return div.innerHTML;
}
