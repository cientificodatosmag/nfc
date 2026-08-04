/**
 * Pruebas de la fusion en el cliente.
 *
 * Aqui se comprueba una sola cosa, pero es la que sostiene todo lo demas:
 * `fusionarEventos` en app.js y `proyectar` en el servidor tienen que decidir
 * exactamente lo mismo. Son dos implementaciones de la misma regla escritas en
 * archivos distintos, y en cuanto se separen un telefono mostrara una cosa y la
 * base otra, sin que nadie sepa cual creer.
 *
 * Igual que las otras pruebas, no se reimplementa nada: se extraen los bloques
 * reales de app.js.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { proyectar } from '../api/_db.mjs';

const src = readFileSync('app.js', 'utf8');

function extraer(nombre) {
  const re = new RegExp(`\\n  (?:async )?function ${nombre}\\(`);
  const m = src.match(re);
  assert.ok(m, `no se encontro la funcion ${nombre} en app.js`);
  const i = src.indexOf('{', m.index + m[0].length - 1);
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

const FUNCIONES = ['fusionarEventos', 'registroParaFusion', 'tapadoPorReinicio'];

const preludio = `
  const PASADAS = 2;
  const rot = { progreso: {}, modulos: [], seleccion: null };
  const window = { NfcSync: { alias: (d) => String(d) } };
  const console = { log() {}, warn() {}, error() {} };
  let guardados = 0;
  function guardarProgreso() { guardados++; }
  function renderProgresoTabla() {}
  function aplicarFiltros() {}
  function actualizarUiRotulado() {}
`;

const api = new Function(`${preludio}${FUNCIONES.map(extraer).join('\n')}
  return { rot, fusionarEventos };`)();

const { rot, fusionarEventos } = api;

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

const ev = (id, mods) => ({
  id, tipo: 'grabada', modulo: 'OOC-MNA-001', pasada: 1, numero: 1,
  texto: 'OOC-MNA-001-001', uid: 'AA', fecha: '2026-08-01T10:00:00.000Z',
  dispositivo: 'd-1', ...mods,
});
const reset = (id, mods) => ev(id, { tipo: 'reset', texto: '', uid: '', ...mods });

function fusionarDesdeCero(eventos) {
  rot.progreso = {};
  fusionarEventos(eventos);
  return rot.progreso;
}

/** Lo que quedo vivo en el cliente, como conjunto comparable. */
function clavesCliente(progreso) {
  const fuera = [];
  Object.keys(progreso).forEach((codigo) => {
    const pasadas = progreso[codigo].pasadas || {};
    Object.keys(pasadas).forEach((p) => {
      Object.keys(pasadas[p]).forEach((n) => {
        fuera.push(`${codigo}|${p}|${n}|${pasadas[p][n].id}`);
      });
    });
  });
  return fuera.sort();
}

function clavesServidor(eventos) {
  return proyectar(eventos)
    .etiquetas.map((e) => `${e.modulo}|${e.pasada}|${e.numero}|${e.id}`)
    .sort();
}

/** El contrato entero, en una linea: cliente y servidor deciden lo mismo. */
function coinciden(nombre, eventos) {
  prueba(nombre, () => {
    assert.deepEqual(clavesCliente(fusionarDesdeCero(eventos)), clavesServidor(eventos));
  });
}

console.log('\n== la fusion del cliente decide igual que el servidor ==');
coinciden('una etiqueta sola', [ev('a')]);
coinciden('la escritura mas nueva gana', [
  ev('a', { fecha: '2026-08-01T10:00:00.000Z' }),
  ev('b', { fecha: '2026-08-01T11:00:00.000Z', dispositivo: 'd-2' }),
]);
coinciden('a igual fecha desempata el id', [
  ev('aaa'), ev('bbb', { dispositivo: 'd-2' }),
]);
coinciden('la mas nueva llegando PRIMERO', [
  ev('b', { fecha: '2026-08-01T11:00:00.000Z', dispositivo: 'd-2' }),
  ev('a', { fecha: '2026-08-01T10:00:00.000Z' }),
]);
coinciden('las pasadas no se pisan', [ev('a', { pasada: 1 }), ev('b', { pasada: 2 })]);
coinciden('modulos distintos', [ev('a'), ev('b', { modulo: 'ORC-MNA-044' })]);
coinciden('un reset borra lo anterior', [ev('a'), reset('r', { fecha: '2026-08-02T10:00:00.000Z' })]);
coinciden('un reset NO borra lo posterior', [
  ev('a'),
  reset('r', { fecha: '2026-08-02T10:00:00.000Z' }),
  ev('c', { fecha: '2026-08-03T10:00:00.000Z' }),
]);
coinciden('un reset de una pasada no toca la otra', [
  ev('a', { pasada: 1 }),
  ev('b', { pasada: 2 }),
  reset('r', { pasada: 1, fecha: '2026-08-02T10:00:00.000Z' }),
]);
coinciden('un reset de otro modulo no afecta', [
  ev('a'), reset('r', { modulo: 'ORC-MNA-044', fecha: '2026-08-02T10:00:00.000Z' }),
]);

// El caso que solo se da sincronizando: el reinicio baja en un lote y el evento
// anterior a el en otro posterior, porque el telefono que lo grabo subio tarde.
coinciden('un evento anterior al reset que llega DESPUES', [
  reset('r', { fecha: '2026-08-02T10:00:00.000Z' }),
  ev('a', { fecha: '2026-08-01T10:00:00.000Z' }),
]);

console.log('\n== convergencia ==');
prueba('dos telefonos sincronizando en distinto orden acaban igual', () => {
  const a = ev('a', { fecha: '2026-08-01T10:00:00.000Z', dispositivo: 'd-1' });
  const b = ev('b', { fecha: '2026-08-01T11:00:00.000Z', dispositivo: 'd-2', numero: 2 });
  const c = ev('c', { fecha: '2026-08-01T12:00:00.000Z', dispositivo: 'd-1', pasada: 2 });
  const uno = clavesCliente(fusionarDesdeCero([a, b, c]));
  const otro = clavesCliente(fusionarDesdeCero([c, a, b]));
  assert.deepEqual(uno, otro, 'sin esto, dos telefonos mostrarian cosas distintas');
});
prueba('fusionar dos veces el mismo lote no cambia nada', () => {
  const lote = [ev('a'), ev('b', { numero: 2 })];
  const uno = clavesCliente(fusionarDesdeCero(lote));
  fusionarEventos(lote);
  assert.deepEqual(clavesCliente(rot.progreso), uno, 'bajar dos veces no puede duplicar');
});
prueba('lo propio no se pisa con una version vieja del servidor', () => {
  rot.progreso = {};
  fusionarEventos([ev('nuevo', { fecha: '2026-08-05T10:00:00.000Z', uid: 'MIO' })]);
  fusionarEventos([ev('viejo', { fecha: '2026-08-01T10:00:00.000Z', uid: 'AJENO' })]);
  assert.equal(rot.progreso['OOC-MNA-001'].pasadas[1][1].uid, 'MIO');
});

console.log('\n== datos que llegan de fuera ==');
prueba('un modulo que este telefono nunca toco aparece igual', () => {
  rot.progreso = {};
  rot.modulos = [];
  fusionarEventos([ev('a', { finca: 'Alamos', responsable: 'Fulano', region: 'OCC' })]);
  assert.equal(rot.progreso['OOC-MNA-001'].finca, 'Alamos');
});
prueba('el maestro local manda sobre lo que diga el otro telefono', () => {
  rot.progreso = {};
  rot.modulos = [{ codigo: 'OOC-MNA-001', finca: 'La buena', responsable: 'R', region: 'OCC' }];
  fusionarEventos([ev('a', { finca: '<script>alert(1)</script>' })]);
  assert.equal(rot.progreso['OOC-MNA-001'].finca, 'La buena',
    'no hay razon para pintar un texto ajeno teniendo el bueno en casa');
});
prueba('una pasada fuera de rango se ignora', () => {
  rot.progreso = {};
  rot.modulos = [];
  fusionarEventos([ev('a', { pasada: 9 })]);
  assert.deepEqual(rot.progreso['OOC-MNA-001'].pasadas, {});
});

console.log(`\n${ok} pruebas pasadas, ${mal} fallidas\n`);
process.exit(mal ? 1 : 0);
