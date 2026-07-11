'use strict';

/* ─────────────────────────────────────────────
   ESTADO GLOBAL (Memoria)
───────────────────────────────────────────── */
let intervaloRefresco = null;

/* ─────────────────────────────────────────────
   REFERENCIAS AL DOM
───────────────────────────────────────────── */
const vistaLogin = document.getElementById('vista-login');
const vistaExito = document.getElementById('vista-exito');
const tarjetaLogin = document.getElementById('tarjeta-login');

const inputUsuario = document.getElementById('campoUsuario');
const inputContrasena = document.getElementById('campoContrasena');
const btnOjo = document.getElementById('btnOjo');
const btnIngresar = document.getElementById('btnIngresar');
const contenedorError = document.getElementById('contenedorError');
const textoError = document.getElementById('textoError');

// Elementos de la vista de éxito
const lblNombreUsuario = document.getElementById('lblNombreUsuario');
const btnCerrarSesion = document.getElementById('btnCerrarSesion');

/* ─────────────────────────────────────────────
   SVGs PARA EL BOTÓN OJO
───────────────────────────────────────────── */
const SVGOjoOculto = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const SVGOjoVisible = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

/* ─────────────────────────────────────────────
   SERVICIO DE AUTENTICACIÓN
   Usa EXCLUSIVAMENTE las APIs oficiales
───────────────────────────────────────────── */
const servicioAutenticacion = {

  /** POST /api/auth/login */
  async iniciarSesion(username, password) {
    const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.AUTH_LOGIN}`;
    const config = {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ username, password }),
    };

    let respuesta;
    try {
      respuesta = await fetch(url, config);
    } catch (e) {
      throw new Error("No se pudo conectar al servidor. Revise su conexión.");
    }

    if (!respuesta.ok) {
      let mensaje = "Credenciales incorrectas.";
      try {
        const datos = await respuesta.json();
        mensaje = datos.message || datos.error || mensaje;
      } catch (e) { }
      throw new Error(mensaje);
    }
    const json = await respuesta.json();
    return json.data || json; // Retorna los tokens desde la raíz o data
  },

  /** POST /api/auth/refresh-token */
  async refrescarToken(refreshToken) {
    const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.AUTH_REFRESH}`;
    const respuesta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!respuesta.ok) throw new Error("Sesión expirada.");
    const json = await respuesta.json();
    return json.data || json;
  },

  /** POST /api/auth/logout */
  async cerrarSesion(accessToken, refreshToken) {
    try {
      await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.AUTH_LOGOUT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
        body: JSON.stringify({ refreshToken }),
      });
    } catch (e) { /* Silencioso */ }
  }
};

/* ─────────────────────────────────────────────
   LÓGICA DE INTERFAZ
───────────────────────────────────────────── */

// Foco inicial
window.addEventListener('DOMContentLoaded', () => {
  inputUsuario.focus();
});

// Mostrar/Ocultar contraseña
btnOjo.addEventListener('click', () => {
  const tipoActual = inputContrasena.getAttribute('type');
  if (tipoActual === 'password') {
    inputContrasena.setAttribute('type', 'text');
    btnOjo.innerHTML = SVGOjoVisible;
  } else {
    inputContrasena.setAttribute('type', 'password');
    btnOjo.innerHTML = SVGOjoOculto;
  }
});

// Ejecutar login al dar Enter
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !vistaLogin.classList.contains('oculto')) {
    manejarLogin();
  }
});

// Botón Iniciar Sesión
btnIngresar.addEventListener('click', manejarLogin);

// Botón Cerrar Sesión
btnCerrarSesion.addEventListener('click', async () => {
  btnCerrarSesion.disabled = true;
  btnCerrarSesion.innerText = "Cerrando…";

  await servicioAutenticacion.cerrarSesion(
    SesionAuth.getToken(),
    SesionAuth.getRefreshToken()
  );

  // Limpiar estado
  clearInterval(intervaloRefresco);
  SesionAuth.limpiar();

  // Limpiar formulario y restaurar vista
  inputContrasena.value = '';
  contenedorError.classList.add('oculto');
  btnCerrarSesion.disabled = false;
  btnCerrarSesion.innerText = "Cerrar sesión";

  vistaExito.classList.add('oculto');
  vistaLogin.classList.remove('oculto');
});

/* ─────────────────────────────────────────────
   FUNCIONES PRINCIPALES
───────────────────────────────────────────── */
async function manejarLogin() {
  const user = inputUsuario.value.trim();
  const pass = inputContrasena.value.trim();

  // Validación básica
  if (!user || !pass) {
    mostrarError("Por favor complete todos los campos.");
    agitarTarjeta();
    return;
  }

  // Estado de carga
  setCargando(true);
  contenedorError.classList.add('oculto');

  try {
    const datos = await servicioAutenticacion.iniciarSesion(user, pass);

    // Guardar tokens en sessionStorage para que las demás páginas los lean
    SesionAuth.guardar(datos.accessToken, datos.refreshToken, user);

    // Configurar refresco automático
    if (intervaloRefresco) clearInterval(intervaloRefresco);
    intervaloRefresco = setInterval(rutinaRefresco, API_CONFIG.INTERVALO_REFRESH_MS);

    // Cambiar a vista de éxito
    lblNombreUsuario.innerText = user;

    vistaLogin.classList.add('oculto');
    vistaExito.classList.remove('oculto');

  } catch (err) {
    mostrarError(err.message || "Error al autenticar. Intente nuevamente.");
    agitarTarjeta();
    inputContrasena.value = ''; // Limpiar contraseña en error
  } finally {
    setCargando(false);
  }
}

let _intentosRefrescoFallidos = 0;

async function rutinaRefresco() {
  try {
    const nuevaData = await servicioAutenticacion.refrescarToken(SesionAuth.getRefreshToken());
    SesionAuth.actualizarToken(nuevaData.accessToken);
    _intentosRefrescoFallidos = 0; // Resetear contador de fallos
    console.info('[Auth] Token refrescado automáticamente.');
  } catch (err) {
    _intentosRefrescoFallidos++;
    console.warn(`[Auth] Fallo al refrescar token (intento ${_intentosRefrescoFallidos}/3):`, err.message);
    // Solo forzar logout después de 3 fallos consecutivos
    // (evita cerrar sesión por un error temporal del proxy)
    if (_intentosRefrescoFallidos >= 3) {
      console.error('[Auth] 3 fallos consecutivos de refresh. Cerrando sesión.');
      btnCerrarSesion.click();
    }
  }
}

/* ─────────────────────────────────────────────
   UTILIDADES
───────────────────────────────────────────── */
function mostrarError(mensaje) {
  textoError.innerText = mensaje;
  contenedorError.classList.remove('oculto');
}

function agitarTarjeta() {
  tarjetaLogin.classList.remove('sacudir');
  // Forzar reflow para reiniciar la animación
  void tarjetaLogin.offsetWidth;
  tarjetaLogin.classList.add('sacudir');
}

function setCargando(estaCargando) {
  if (estaCargando) {
    inputUsuario.disabled = true;
    inputContrasena.disabled = true;
    btnIngresar.disabled = true;
    btnIngresar.innerHTML = '<div class="icono-cargando"></div> Autenticando…';
  } else {
    inputUsuario.disabled = false;
    inputContrasena.disabled = false;
    btnIngresar.disabled = false;
    btnIngresar.innerHTML = 'Iniciar Sesión';
  }
}