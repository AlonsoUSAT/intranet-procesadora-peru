/* ═══════════════════════════════════════════════════════════════
   LAYOUT.JS — Lógica compartida de sidebar/hamburguesa
   Se usa en TODAS las páginas (index, reportes, etc.)
═══════════════════════════════════════════════════════════════ */

'use strict';

(function () {
  document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('sidebar');
    const btnToggle = document.getElementById('btnToggleSidebar');
    if (!sidebar || !btnToggle) return;

    // --- Crear overlay oscuro para móvil ---
    let overlay = document.getElementById('sidebarOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sidebarOverlay';
      overlay.className = 'sidebar-overlay';
      document.body.appendChild(overlay);
    }

    // --- Toggle sidebar ---
    btnToggle.addEventListener('click', function () {
      sidebar.classList.toggle('oculto');
      overlay.classList.toggle('activo', !sidebar.classList.contains('oculto'));
      document.body.classList.toggle('sidebar-abierto', !sidebar.classList.contains('oculto'));
    });

    // --- Cerrar sidebar al hacer clic en overlay ---
    overlay.addEventListener('click', function () {
      sidebar.classList.add('oculto');
      overlay.classList.remove('activo');
      document.body.classList.remove('sidebar-abierto');
    });

    // --- En móvil: cerrar sidebar al navegar ---
    sidebar.querySelectorAll('.nav-item a').forEach(function (link) {
      link.addEventListener('click', function () {
        if (window.innerWidth < 1024) {
          sidebar.classList.add('oculto');
          overlay.classList.remove('activo');
          document.body.classList.remove('sidebar-abierto');
        }
      });
    });

    // --- Estado inicial según ancho de pantalla ---
    function checkInitialState() {
      if (window.innerWidth < 1024) {
        sidebar.classList.add('oculto');
        overlay.classList.remove('activo');
      } else {
        sidebar.classList.remove('oculto');
        overlay.classList.remove('activo');
      }
    }

    checkInitialState();

    // --- Listener de resize ---
    let resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(checkInitialState, 150);
    });
  });
})();
