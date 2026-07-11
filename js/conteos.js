'use strict';

/* ═══════════════════════════════════════════════════
   AGRUPACIÓN DE CONTEOS DE INVENTARIO
   Procesadora Perú S.A.C.
   ─────────────────────────────────────────────────
   La toma de inventario se hace producto por producto.
   Un "conteo" es el trabajo de un operario en un almacén:
   agrupa todos los registros de ese operario en ese almacén
   y calcula cuántos productos contó, la cantidad total y
   cuánto tiempo le tomó (del primer al último registro).

   Lo usan:
     - reporte-incidencias.js  (Resumen de conteos)
     - reporte-panel.js        (KPIs del día)

   Trabaja SOLO con datos reales de /api/almacen/inventarios.
   ═══════════════════════════════════════════════════ */

/**
 * Agrupa los registros de inventario en "conteos".
 * Un conteo = un operario en un almacén.
 *
 * @param {Array} registros - Lista de inventarios de la API.
 * @returns {Array} Lista de conteos con sus métricas.
 */
function agruparConteos(registros) {
  if (!registros || !registros.length) return [];

  const grupos = new Map();

  registros.forEach(r => {
    if (!r.fechaCreacion) return;

    const operario = r.usuarioCreacion || '—';
    const almacen  = r.almacen || r.idAlmacen || '—';
    const clave    = `${operario}|${almacen}`;

    if (!grupos.has(clave)) {
      grupos.set(clave, {
        operario,
        almacen,
        sucursal: r.sucursal || r.idSucursal || '—',
        registros: [],
      });
    }
    grupos.get(clave).registros.push(r);
  });

  const conteos = [];

  for (const grupo of grupos.values()) {
    const regs = grupo.registros;
    regs.sort((a, b) => new Date(a.fechaCreacion) - new Date(b.fechaCreacion));

    const inicio = new Date(regs[0].fechaCreacion);
    const fin    = new Date(regs[regs.length - 1].fechaCreacion);
    const duracionMin = Math.round((fin.getTime() - inicio.getTime()) / 60000);

    // Suma de cantidades (cuando el dato existe y es numérico)
    let cantidadTotal = 0;
    let hayCantidades = false;
    regs.forEach(r => {
      const c = parseFloat(r.cantidad);
      if (!isNaN(c)) { cantidadTotal += c; hayCantidades = true; }
    });

    conteos.push({
      operario: grupo.operario,
      almacen: grupo.almacen,
      sucursal: grupo.sucursal,
      productosContados: regs.length,
      cantidadTotal: hayCantidades ? Math.round(cantidadTotal * 100) / 100 : null,
      inicio: regs[0].fechaCreacion,
      fin: regs[regs.length - 1].fechaCreacion,
      duracionMin,
    });
  }

  // Más reciente primero (por hora de fin)
  conteos.sort((a, b) => new Date(b.fin) - new Date(a.fin));
  return conteos;
}
