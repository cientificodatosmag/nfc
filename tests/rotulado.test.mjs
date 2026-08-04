/**
 * Pruebas de la logica de doble pasada.
 *
 * No reimplementa nada: extrae los bloques reales de app.js y los evalua, de
 * modo que si el codigo cambia y se rompe, la prueba lo ve.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync('app.js', 'utf8');

/** Saca una funcion completa de app.js contando llaves desde su declaracion. */
function extraer(nombre) {
  const re = new RegExp(`\\n  (?:async )?function ${nombre}\\(`);
  const m = src.match(re);
  assert.ok(m, `no se encontro la funcion ${nombre} en app.js`);
  let i = src.indexOf('{', m.index + m[0].length - 1);
  let nivel = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') nivel++;
    else if (src[j] === '}') {
      nivel--;
      if (nivel === 0) return src.slice(m.index, j + 1);
    }
  }
  throw new Error(`no se pudo cerrar ${nombre}`);
}

const FUNCIONES = [
  'totalPorPasada', 'totalModulo', 'textoEtiqueta', 'registroDe', 'etiquetasDe',
  'hechasEnPasada', 'hechasDe', 'pasadaCompleta', 'moduloCompleto',
  'siguientePendiente', 'siguienteObjetivo', 'uidYaUsado', 'migrarV1', 'leerJson',
];

// Entorno minimo que esas funciones esperan.
const preludio = `
  const ETIQUETAS_EXTRA = 4;
  const PASADAS = 2;
  const ROT_PROGRESO_KEY = 'nfc_rotulado_progreso';
  const ROT_PROGRESO_V2_KEY = 'nfc_rotulado_progreso_v2';
  const ROT_MIGRACION_KEY = 'nfc_rotulado_migracion_v2';
  const rot = { progreso: {}, pasada: 1, indice: 0, seleccion: null, migracionFallida: '' };
  const almacen = {};
  const localStorage = {
    getItem: (k) => (k in almacen ? almacen[k] : null),
    setItem: (k, v) => { almacen[k] = String(v); },
  };
  function dispositivoId() { return 'd-prueba'; }
  function guardarClave(k, v) { almacen[k] = String(v); return true; }
  function showToast() {}
  const console = { log() {}, error() {}, warn() {} };
`;

const cuerpo = preludio + FUNCIONES.map(extraer).join('\n');
const api = new Function(`${cuerpo}
  return { rot, almacen, totalPorPasada, totalModulo, textoEtiqueta, etiquetasDe,
           hechasEnPasada, hechasDe, pasadaCompleta, moduloCompleto,
           siguientePendiente, siguienteObjetivo, uidYaUsado, migrarV1 };`)();

const {
  rot, almacen, totalPorPasada, totalModulo, textoEtiqueta, hechasEnPasada, hechasDe,
  pasadaCompleta, moduloCompleto, siguientePendiente, siguienteObjetivo, uidYaUsado,
  migrarV1,
} = api;

let pasadas = 0;
let fallidas = 0;
function prueba(nombre, fn) {
  try {
    fn();
    pasadas++;
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    fallidas++;
    console.log(`  FALLA ${nombre}\n        ${e.message}`);
  }
}

const MOD = { codigo: 'OOC-MNA-001', ramales: 3, finca: 'F', region: 'R', responsable: 'X' };
// ramales 3 + 4 = 7 por pasada, 14 en total.

function grabar(pasada, numeros, uidBase = 'U') {
  rot.progreso[MOD.codigo] = rot.progreso[MOD.codigo] || { pasadas: {} };
  const r = rot.progreso[MOD.codigo];
  r.pasadas[pasada] = r.pasadas[pasada] || {};
  numeros.forEach((n) => {
    r.pasadas[pasada][n] = {
      texto: textoEtiqueta(MOD.codigo, n), uid: `${uidBase}${pasada}-${n}`,
      fecha: '2026-08-03T00:00:00Z', dispositivo: 'd-prueba',
    };
  });
}
function reset() { rot.progreso = {}; }

console.log('\n== totales ==');
prueba('7 etiquetas por pasada (ramales 3 + 4)', () => assert.equal(totalPorPasada(MOD), 7));
prueba('14 en total con dos pasadas', () => assert.equal(totalModulo(MOD), 14));
prueba('texto con relleno a tres cifras', () => assert.equal(textoEtiqueta('X-1', 7), 'X-1-007'));

console.log('\n== completitud ==');
prueba('modulo vacio no esta completo', () => {
  reset();
  assert.equal(moduloCompleto(MOD), false);
});
prueba('pasada 1 llena NO completa el modulo', () => {
  reset();
  grabar(1, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(pasadaCompleta(MOD, 1), true);
  assert.equal(pasadaCompleta(MOD, 2), false);
  assert.equal(moduloCompleto(MOD), false, 'con una sola pasada NO puede darse por cumplido');
});
prueba('las dos pasadas llenas SI completan', () => {
  reset();
  grabar(1, [1, 2, 3, 4, 5, 6, 7]);
  grabar(2, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(moduloCompleto(MOD), true);
  assert.equal(hechasDe(MOD.codigo), 14);
});
prueba('las pasadas se cuentan por separado', () => {
  reset();
  grabar(1, [1, 2, 3]);
  grabar(2, [1]);
  assert.equal(hechasEnPasada(MOD.codigo, 1), 3);
  assert.equal(hechasEnPasada(MOD.codigo, 2), 1);
  assert.equal(hechasDe(MOD.codigo), 4);
});
prueba('mas ramales en el maestro descompletan el modulo', () => {
  reset();
  grabar(1, [1, 2, 3, 4, 5, 6, 7]);
  grabar(2, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(moduloCompleto(MOD), true);
  assert.equal(moduloCompleto({ ...MOD, ramales: 5 }), false,
    'el total sale del maestro vivo, no de lo guardado');
});

console.log('\n== donde retomar ==');
prueba('modulo nuevo arranca en pasada 1 etiqueta 1', () => {
  reset();
  assert.deepEqual(siguienteObjetivo(MOD), { pasada: 1, numero: 1 });
});
prueba('rellena huecos de la pasada 1 antes de la 2', () => {
  reset();
  grabar(1, [1, 2, 4, 5, 6, 7]);   // falta la 3
  grabar(2, [1, 2]);
  assert.deepEqual(siguienteObjetivo(MOD), { pasada: 1, numero: 3 },
    'un hueco en la pasada 1 manda sobre el avance de la 2');
});
prueba('pasa a la pasada 2 cuando la 1 esta llena', () => {
  reset();
  grabar(1, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(siguienteObjetivo(MOD), { pasada: 2, numero: 1 });
});
prueba('devuelve null con todo hecho', () => {
  reset();
  grabar(1, [1, 2, 3, 4, 5, 6, 7]);
  grabar(2, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(siguienteObjetivo(MOD), null);
});
prueba('siguientePendiente da la vuelta al llegar al final', () => {
  reset();
  grabar(1, [3, 4, 5, 6, 7]);      // faltan 1 y 2
  assert.equal(siguientePendiente(MOD.codigo, 1, 7, 6), 1,
    'buscando desde la 6 debe volver al principio');
});

console.log('\n== etiqueta ya usada ==');
prueba('UID nuevo no esta usado', () => {
  reset();
  grabar(1, [1, 2, 3]);
  assert.equal(uidYaUsado(MOD.codigo, 'DESCONOCIDO'), null);
});
prueba('detecta un UID de la pasada 1 durante la 2', () => {
  reset();
  grabar(1, [1, 2, 3]);
  assert.deepEqual(uidYaUsado(MOD.codigo, 'U1-2'), { pasada: 1, numero: 2 });
});
prueba('UID vacio nunca bloquea', () => {
  reset();
  grabar(1, [1]);
  rot.progreso[MOD.codigo].pasadas[1][1].uid = '';
  assert.equal(uidYaUsado(MOD.codigo, ''), null,
    'una lectura sin UID no puede bloquear el grabado');
});

console.log('\n== migracion del avance viejo ==');
prueba('el formato v1 entra como pasada 1', () => {
  reset();
  almacen['nfc_rotulado_progreso'] = JSON.stringify({
    'OOC-MNA-001': {
      total: 7, region: 'R', responsable: 'X', finca: 'F',
      etiquetas: {
        1: { texto: 'OOC-MNA-001-001', uid: 'AA', fecha: '2026-07-01T10:00:00Z' },
        2: { texto: 'OOC-MNA-001-002', uid: 'BB', fecha: '2026-07-01T10:01:00Z' },
      },
    },
  });
  const salida = migrarV1();
  assert.equal(Object.keys(salida['OOC-MNA-001'].pasadas[1]).length, 2);
  assert.deepEqual(salida['OOC-MNA-001'].pasadas[2], {}, 'la pasada 2 arranca vacia');
  assert.equal(salida['OOC-MNA-001'].pasadas[1][1].uid, 'AA', 'conserva el UID original');
  assert.equal(salida['OOC-MNA-001'].pasadas[1][1].fecha, '2026-07-01T10:00:00Z',
    'conserva la fecha original');
  assert.equal(salida['OOC-MNA-001'].finca, 'F');
});
prueba('la clave vieja NO se borra', () => {
  assert.ok(almacen['nfc_rotulado_progreso'], 'el respaldo v1 debe seguir intacto tras migrar');
});
prueba('el total NO se guarda en el formato nuevo', () => {
  const guardado = JSON.parse(almacen['nfc_rotulado_progreso_v2']);
  assert.equal(guardado['OOC-MNA-001'].total, undefined,
    'guardar el total es lo que hacia que un cambio de ramales mintiera');
});
prueba('sin datos previos no rompe', () => {
  delete almacen['nfc_rotulado_progreso'];
  delete almacen['nfc_rotulado_progreso_v2'];
  assert.deepEqual(migrarV1(), {});
});
prueba('un avance CORRUPTO se denuncia, no se presenta como cero', () => {
  almacen['nfc_rotulado_progreso'] = '{ esto no es json';
  rot.migracionFallida = '';
  const salida = migrarV1();
  assert.deepEqual(salida, {}, 'devuelve vacio...');
  assert.ok(rot.migracionFallida,
    '...pero DEBE marcar el fallo: mostrar "0 grabadas" haria que se re-rotule el modulo');
  assert.ok(almacen['nfc_rotulado_progreso'], 'y el v1 sigue ahi para recuperarlo');
  assert.match(almacen['nfc_rotulado_migracion_v2'], /^fallida/);
});
prueba('vacio de verdad NO se marca como fallo', () => {
  almacen['nfc_rotulado_progreso'] = '{}';
  rot.migracionFallida = '';
  assert.deepEqual(migrarV1(), {});
  assert.equal(rot.migracionFallida, '', 'sin datos no es lo mismo que datos rotos');
  assert.equal(almacen['nfc_rotulado_migracion_v2'], 'sin-datos');
});

console.log(`\n${pasadas} pruebas pasadas, ${fallidas} fallidas\n`);
process.exit(fallidas ? 1 : 0);
