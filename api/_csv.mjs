/**
 * Construccion de CSV para Excel en Windows, que es donde se va a abrir.
 *
 * Dos detalles que no son cosmeticos:
 *
 *  - El BOM al principio. Sin el, Excel lee el archivo como ANSI y "Módulo"
 *    sale "MÃ³dulo". Los nombres de las fincas van llenos de acentos.
 *  - Saltos \r\n. Excel abre igual con \n, pero otras herramientas de oficina
 *    meten todo en una sola fila.
 */

/** Un valor -> celda. Se entrecomilla siempre: mas simple y nunca se rompe. */
function celda(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  return `"${texto.replace(/"/g, '""')}"`;
}

export function aCsv(cabecera, filas) {
  const lineas = [cabecera, ...filas].map((f) => f.map(celda).join(','));
  return '﻿' + lineas.join('\r\n') + '\r\n';
}

export const CABECERA_DETALLE = [
  'Codigo_modulo', 'Region', 'Responsable', 'Finca', 'Pasada', 'Numero_etiqueta',
  'Total_por_pasada', 'Texto_grabado', 'UID', 'Fecha_hora', 'Dispositivo', 'Duplicado',
];

export function filasDetalle(etiquetas, duplicados) {
  const repetidas = new Set(duplicados);
  return [...etiquetas]
    .sort((a, b) => a.modulo.localeCompare(b.modulo) || a.pasada - b.pasada || a.numero - b.numero)
    .map((e) => [
      e.modulo, e.region || '', e.responsable || '', e.finca || '',
      e.pasada, e.numero, e.totalPasada || '', e.texto, e.uid, e.fecha,
      e.dispositivo,
      repetidas.has(`${e.modulo}|${e.pasada}|${e.numero}`) ? 'SI' : '',
    ]);
}

export const CABECERA_RESUMEN = [
  'Codigo_modulo', 'Region', 'Responsable', 'Finca',
  'Pasada_1', 'Pasada_2', 'Total_grabadas', 'Duplicadas', 'Ultima_fecha', 'Telefonos',
];

export function filasResumen(etiquetas, duplicados) {
  const repetidas = new Set(duplicados);
  const porModulo = new Map();

  for (const e of etiquetas) {
    if (!porModulo.has(e.modulo)) {
      porModulo.set(e.modulo, {
        modulo: e.modulo, region: e.region || '', responsable: e.responsable || '',
        finca: e.finca || '', 1: 0, 2: 0, duplicadas: 0, ultima: '', telefonos: new Set(),
      });
    }
    const m = porModulo.get(e.modulo);
    m[e.pasada] = (m[e.pasada] || 0) + 1;
    if (e.fecha > m.ultima) m.ultima = e.fecha;
    m.telefonos.add(e.dispositivo);
    if (repetidas.has(`${e.modulo}|${e.pasada}|${e.numero}`)) m.duplicadas++;
  }

  return [...porModulo.values()]
    .sort((a, b) => a.modulo.localeCompare(b.modulo))
    .map((m) => [
      m.modulo, m.region, m.responsable, m.finca,
      m[1], m[2], m[1] + m[2], m.duplicadas || '', m.ultima, m.telefonos.size,
    ]);
}
