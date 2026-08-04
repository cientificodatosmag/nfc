/**
 * Pruebas de la logica del backend que no necesita base de datos:
 * validacion de eventos y proyeccion del log.
 *
 * La proyeccion es lo mas delicado de todo el sistema: si no fuera conmutativa,
 * dos telefonos que sincronizan en distinto orden acabarian mostrando cosas
 * distintas, y nadie sabria cual creer.
 */
import assert from 'node:assert/strict';
import { validarEvento, proyectar } from '../api/_db.mjs';
import {
  aCsv, CABECERA_DETALLE, CABECERA_RESUMEN, filasDetalle, filasResumen,
} from '../api/_csv.mjs';

let ok = 0;
let mal = 0;
function prueba(nombre, fn) {
  try {
    fn();
    ok++;
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    mal++;
    console.log(`  FALLA ${nombre}\n        ${e.message}`);
  }
}

const base = {
  id: 'ev-1',
  tipo: 'grabada',
  modulo: 'OOC-MNA-001',
  pasada: 1,
  numero: 7,
  texto: 'OOC-MNA-001-007',
  uid: '04:A2:B3:C4',
  fecha: new Date().toISOString(),
  dispositivoId: 'd-abc',
  totalPasada: 16,
  region: 'OCCIDENTE CENTRO',
  responsable: 'Fulano',
  finca: 'Alamos',
};

console.log('\n== validacion ==');
prueba('un evento correcto pasa', () => {
  const r = validarEvento(base);
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.evento.modulo, 'OOC-MNA-001');
});
prueba('sin id se rechaza', () => {
  assert.equal(validarEvento({ ...base, id: '' }).ok, false);
});
prueba('modulo con formato raro se rechaza', () => {
  assert.equal(validarEvento({ ...base, modulo: 'NO-ES-UN-MODULO' }).ok, false);
});
prueba('pasada 3 se rechaza', () => {
  assert.equal(validarEvento({ ...base, pasada: 3 }).ok, false);
});
prueba('numero fuera de rango se rechaza', () => {
  assert.equal(validarEvento({ ...base, numero: 0 }).ok, false);
  assert.equal(validarEvento({ ...base, numero: 401 }).ok, false);
});
prueba('texto con HTML se rechaza', () => {
  const r = validarEvento({ ...base, texto: '<img src=x onerror=alert(1)>' });
  assert.equal(r.ok, false, 'el formato estricto es la primera barrera contra inyeccion');
});
prueba('los campos libres se recortan a 120', () => {
  const r = validarEvento({ ...base, finca: 'F'.repeat(500) });
  assert.equal(r.ok, true);
  assert.equal(r.evento.finca.length, 120);
});
prueba('una fecha en el futuro se rechaza', () => {
  const manana = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
  const r = validarEvento({ ...base, fecha: manana });
  assert.equal(r.ok, false, 'un reloj adelantado ganaria TODOS los desempates');
});
prueba('una fecha de hace un ano se acepta', () => {
  const viejo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
  const r = validarEvento({ ...base, fecha: viejo });
  assert.equal(r.ok, true, 'es lo que traen los eventos migrados del avance ya grabado');
});
prueba('una fecha de hace tres anos se rechaza', () => {
  const antiguo = new Date(Date.now() - 3 * 365 * 24 * 3600 * 1000).toISOString();
  assert.equal(validarEvento({ ...base, fecha: antiguo }).ok, false);
});
prueba('uid vacio se acepta', () => {
  assert.equal(validarEvento({ ...base, uid: '' }).ok, true);
});
prueba('sin dispositivo se rechaza', () => {
  assert.equal(validarEvento({ ...base, dispositivoId: '' }).ok, false);
});

console.log('\n== proyeccion ==');
const ev = (id, mods) => ({
  id, tipo: 'grabada', modulo: 'M-AAA-001', pasada: 1, numero: 1,
  texto: 'T', uid: 'U', fecha: '2026-08-01T10:00:00.000Z', dispositivo: 'd-1', ...mods,
});

prueba('una etiqueta sola sobrevive', () => {
  const { etiquetas } = proyectar([ev('a')]);
  assert.equal(etiquetas.length, 1);
});
prueba('la escritura mas nueva gana la misma clave', () => {
  const { etiquetas } = proyectar([
    ev('a', { fecha: '2026-08-01T10:00:00.000Z', uid: 'VIEJO' }),
    ev('b', { fecha: '2026-08-01T11:00:00.000Z', uid: 'NUEVO', dispositivo: 'd-2' }),
  ]);
  assert.equal(etiquetas.length, 1);
  assert.equal(etiquetas[0].uid, 'NUEVO');
});
prueba('el orden de llegada NO cambia el resultado', () => {
  const a = ev('a', { fecha: '2026-08-01T10:00:00.000Z', uid: 'VIEJO' });
  const b = ev('b', { fecha: '2026-08-01T11:00:00.000Z', uid: 'NUEVO', dispositivo: 'd-2' });
  const uno = proyectar([a, b]).etiquetas[0].uid;
  const otro = proyectar([b, a]).etiquetas[0].uid;
  assert.equal(uno, otro, 'sin esto, dos telefonos mostrarian cosas distintas');
});
prueba('a igual fecha desempata el id, no el orden', () => {
  const a = ev('aaa', { uid: 'A' });
  const b = ev('bbb', { uid: 'B', dispositivo: 'd-2' });
  assert.equal(proyectar([a, b]).etiquetas[0].uid, proyectar([b, a]).etiquetas[0].uid);
  assert.equal(proyectar([a, b]).etiquetas[0].uid, 'B', 'gana el id mayor');
});
prueba('dos dispositivos en la misma clave se marcan duplicado', () => {
  const { duplicados } = proyectar([ev('a'), ev('b', { dispositivo: 'd-2' })]);
  assert.deepEqual(duplicados, ['M-AAA-001|1|1'],
    'significa que hay DOS etiquetas fisicas con el mismo texto');
});
prueba('el mismo dispositivo regrabando NO es duplicado', () => {
  const { duplicados } = proyectar([ev('a'), ev('b', { fecha: '2026-08-02T10:00:00.000Z' })]);
  assert.deepEqual(duplicados, []);
});
prueba('las pasadas no se pisan entre si', () => {
  const { etiquetas } = proyectar([ev('a', { pasada: 1 }), ev('b', { pasada: 2 })]);
  assert.equal(etiquetas.length, 2);
});
prueba('idempotente: proyectar dos veces da lo mismo', () => {
  const lote = [ev('a'), ev('b', { numero: 2 }), ev('c', { pasada: 2 })];
  assert.deepEqual(proyectar(lote), proyectar([...lote, ...lote]));
});

console.log('\n== reinicios ==');
const reset = (id, mods) => ({
  id, tipo: 'reset', modulo: 'M-AAA-001', pasada: 0, numero: 0,
  texto: '', uid: '', fecha: '2026-08-02T10:00:00.000Z', dispositivo: 'admin', ...mods,
});

prueba('un reset borra lo anterior', () => {
  const { etiquetas } = proyectar([ev('a'), reset('r')]);
  assert.equal(etiquetas.length, 0);
});
prueba('un reset NO borra lo posterior', () => {
  const { etiquetas } = proyectar([
    ev('a'),
    reset('r'),
    ev('c', { fecha: '2026-08-03T10:00:00.000Z' }),
  ]);
  assert.equal(etiquetas.length, 1, 'lo grabado despues del reinicio se conserva');
});
prueba('un reset de una pasada no toca la otra', () => {
  const { etiquetas } = proyectar([
    ev('a', { pasada: 1 }),
    ev('b', { pasada: 2 }),
    reset('r', { pasada: 1 }),
  ]);
  assert.equal(etiquetas.length, 1);
  assert.equal(etiquetas[0].pasada, 2);
});
prueba('un reset de otro modulo no afecta', () => {
  const { etiquetas } = proyectar([ev('a'), reset('r', { modulo: 'M-BBB-002' })]);
  assert.equal(etiquetas.length, 1);
});
prueba('el reset tambien es conmutativo', () => {
  const a = ev('a');
  const r = reset('r');
  const c = ev('c', { fecha: '2026-08-03T10:00:00.000Z' });
  assert.deepEqual(proyectar([a, r, c]), proyectar([c, r, a]));
});

console.log('\n== duplicados ==');
prueba('un duplicado que un reset borro NO se arrastra', () => {
  const { duplicados } = proyectar([
    ev('a', { dispositivo: 'd-1' }),
    ev('b', { dispositivo: 'd-2' }),
    reset('r', { fecha: '2026-08-05T10:00:00.000Z' }),
  ]);
  assert.deepEqual(duplicados, [],
    'la proyeccion cuenta lo que hay ahora, no lo que hubo');
});
prueba('un duplicado vivo si se reporta', () => {
  const { duplicados } = proyectar([ev('a', { dispositivo: 'd-1' }), ev('b', { dispositivo: 'd-2' })]);
  assert.deepEqual(duplicados, ['M-AAA-001|1|1']);
});

console.log('\n== csv ==');
const etq = (mods) => ({
  modulo: 'OOC-MNA-001', pasada: 1, numero: 1, texto: 'OOC-MNA-001-001',
  uid: '04:A2', fecha: '2026-08-04T10:00:00.000Z', dispositivo: 'd-1',
  totalPasada: 8, region: 'OCCIDENTE', responsable: 'Fulano', finca: 'Álamos', ...mods,
});

prueba('lleva BOM: sin el, Excel en Windows destroza los acentos', () => {
  const csv = aCsv(['a'], [['Álamos']]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
});
prueba('las lineas terminan en CRLF', () => {
  assert.ok(aCsv(['a'], [['x']]).includes('"a"\r\n"x"'));
});
prueba('una comilla dentro del texto no parte la fila', () => {
  const csv = aCsv(['a'], [['Finca "La Buena"']]);
  assert.ok(csv.includes('"Finca ""La Buena"""'));
  assert.equal(csv.trimEnd().split('\r\n').length, 2, 'sigue siendo una sola fila');
});
prueba('una coma dentro del texto tampoco', () => {
  const csv = aCsv(['a', 'b'], [['Uno, dos', 'x']]);
  assert.equal(csv.trimEnd().split('\r\n').length, 2);
});
prueba('un salto de linea dentro de un campo queda entrecomillado', () => {
  const csv = aCsv(['a'], [['dos\nlineas']]);
  assert.ok(csv.includes('"dos\nlineas"'));
});
prueba('el detalle sale ordenado por modulo, pasada y numero', () => {
  const filas = filasDetalle([
    etq({ numero: 2 }), etq({ pasada: 2, numero: 1 }), etq({ numero: 1 }),
    etq({ modulo: 'CEN-MNA-038', numero: 5 }),
  ], []);
  assert.deepEqual(filas.map((f) => `${f[0]}|${f[4]}|${f[5]}`), [
    'CEN-MNA-038|1|5', 'OOC-MNA-001|1|1', 'OOC-MNA-001|1|2', 'OOC-MNA-001|2|1',
  ]);
});
prueba('la columna Duplicado marca solo las repetidas', () => {
  const filas = filasDetalle([etq({ numero: 1 }), etq({ numero: 2 })],
    ['OOC-MNA-001|1|2']);
  const i = CABECERA_DETALLE.indexOf('Duplicado');
  assert.equal(filas[0][i], '');
  assert.equal(filas[1][i], 'SI');
});
prueba('cada fila tiene tantas celdas como la cabecera', () => {
  const filas = filasDetalle([etq({})], []);
  assert.equal(filas[0].length, CABECERA_DETALLE.length);
});
prueba('el resumen cuenta las dos pasadas por separado', () => {
  const filas = filasResumen([
    etq({ pasada: 1, numero: 1 }), etq({ pasada: 1, numero: 2 }), etq({ pasada: 2, numero: 1 }),
  ], []);
  assert.equal(filas.length, 1);
  assert.equal(filas[0][CABECERA_RESUMEN.indexOf('Pasada_1')], 2);
  assert.equal(filas[0][CABECERA_RESUMEN.indexOf('Pasada_2')], 1);
  assert.equal(filas[0][CABECERA_RESUMEN.indexOf('Total_grabadas')], 3);
});
prueba('el resumen cuenta cuantos telefonos tocaron el modulo', () => {
  const filas = filasResumen([
    etq({ numero: 1, dispositivo: 'd-1' }), etq({ numero: 2, dispositivo: 'd-2' }),
  ], []);
  assert.equal(filas[0][CABECERA_RESUMEN.indexOf('Telefonos')], 2);
});
prueba('el resumen se queda con la fecha mas reciente', () => {
  const filas = filasResumen([
    etq({ numero: 1, fecha: '2026-08-01T10:00:00.000Z' }),
    etq({ numero: 2, fecha: '2026-08-04T10:00:00.000Z' }),
  ], []);
  assert.equal(filas[0][CABECERA_RESUMEN.indexOf('Ultima_fecha')], '2026-08-04T10:00:00.000Z');
});

console.log(`\n${ok} pruebas pasadas, ${mal} fallidas\n`);
process.exit(mal ? 1 : 0);
