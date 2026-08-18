/**
 * Pruebas de la carga del maestro en tres niveles.
 *
 * Lo que se comprueba aqui es sobre todo lo que NO debe pasar: que una
 * respuesta rara del servidor sustituya al maestro bueno y deje el desplegable
 * vacio con el operador ya en el modulo. El orden servidor -> cache -> APK solo
 * vale si cada nivel sabe rechazar basura y pasar al siguiente.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

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

const FUNCIONES = [
  'maestroValido', 'bajarMaestro', 'maestroDeCache', 'maestroDelApk',
  'cargarModulos', 'avisarModulosQueSalieron', 'procedenciaMaestro', 'haceCuanto',
  'registroDe', 'etiquetasDe', 'hechasEnPasada', 'hechasDe', 'leerJson',
];

const preludio = `
  const PASADAS = 2;
  const MAX_PASADAS = 2;
  const MAESTRO_CACHE_KEY = 'nfc_maestro_cache';
  const MAESTRO_TIMEOUT_MS = 8000;
  const rot = { modulos: [], progreso: {}, maestro: null, seleccion: null };
  const almacen = {};
  const localStorage = {
    getItem: (k) => (k in almacen ? almacen[k] : null),
    setItem: (k, v) => { almacen[k] = String(v); },
  };
  const window = { APP_CONFIG: { apiBase: 'https://servidor.example' } };
  const DOM = { rotModuloHint: { textContent: '' } };
  const console = { log() {}, warn() {}, error() {} };
  const avisos = [];
  function showToast(m, t) { avisos.push({ m, t }); }
  function guardarClave(k, v) { almacen[k] = String(v); return true; }
  function aplicarFiltros() {}
  function renderProgresoTabla() {}
`;

const api = new Function('fetch', 'AbortController', 'setTimeout', 'clearTimeout', `
  ${preludio}${FUNCIONES.map(extraer).join('\n')}
  return { rot, almacen, avisos, DOM, cargarModulos, maestroValido, procedenciaMaestro };`);

let respuestaDeRed = null;   // lo que contesta el servidor en cada prueba
let respuestaLocal = null;   // lo que trae el APK

function crear() {
  const falso = async (url) => {
    const r = String(url).startsWith('http') ? respuestaDeRed : respuestaLocal;
    if (r === null) throw new Error('sin conexion');
    if (r.status && r.status !== 200) return { ok: false, status: r.status };
    return { ok: true, status: 200, json: async () => r.cuerpo };
  };
  return api(falso, AbortController, setTimeout, clearTimeout);
}

let ok = 0;
let mal = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    ok++;
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    mal++;
    console.log(`  FALLA ${nombre}\n        ${e.message}`);
  }
}

const maestro = (generado, codigos) => ({
  generado,
  modulos: codigos.map((c) => ({ codigo: c, ramales: 3, finca: 'F', region: 'R', responsable: 'X' })),
});

console.log('\n== que cuenta como maestro ==');
{
  const { maestroValido } = crear();
  await prueba('uno normal vale', () => assert.equal(maestroValido(maestro('2026-08-04', ['A'])), true));
  await prueba('null no vale', () => assert.equal(maestroValido(null), false));
  await prueba('sin modulos no vale', () => assert.equal(maestroValido({ modulos: [] }), false,
    'una lista vacia dejaria el desplegable en blanco en pleno campo'));
  await prueba('una pagina de portal cautivo no vale', () =>
    assert.equal(maestroValido({ error: 'inicia sesion' }), false));
  await prueba('ramales no numericos no valen', () =>
    assert.equal(maestroValido({ modulos: [{ codigo: 'A', ramales: '3' }] }), false,
      'de ahi sale el numero de etiquetas: si no es entero, nada cuadra'));
  await prueba('un modulo sin codigo invalida el lote', () =>
    assert.equal(maestroValido({ modulos: [{ codigo: 'A', ramales: 3 }, { ramales: 2 }] }), false));
  await prueba('sin pasadas ni extras vale: se deducen del codigo', () =>
    assert.equal(maestroValido({ modulos: [{ codigo: 'OOC-ASP-001', ramales: 2 }] }), true,
      'el maestro que viaja en el APK es de antes de que existieran esos campos'));
  await prueba('pasadas o extras imposibles invalidan el lote', () => {
    assert.equal(maestroValido({ modulos: [{ codigo: 'A', ramales: 3, pasadas: 0 }] }), false);
    assert.equal(maestroValido({ modulos: [{ codigo: 'A', ramales: 3, pasadas: 9 }] }), false);
    assert.equal(maestroValido({ modulos: [{ codigo: 'A', ramales: 3, etiquetasExtra: -1 }] }), false,
      'de esos campos sale cuantas etiquetas se graban');
    assert.equal(maestroValido({ modulos: [{ codigo: 'A', ramales: 3, etiquetasFijas: 0 }] }), false,
      'cero fijas daria el modulo por hecho sin grabar nada');
  });
  await prueba('etiquetasFijas en null vale: significa contar por ramales', () =>
    assert.equal(maestroValido({ modulos: [{ codigo: 'A', ramales: 3, etiquetasFijas: null }] }), true,
      'asi es como el maestro dice "este no lleva cantidad fija"'));
}

console.log('\n== los tres niveles ==');
await prueba('con senal manda el servidor', async () => {
  const app = crear();
  respuestaDeRed = { cuerpo: maestro('2026-08-04', ['A', 'B']) };
  respuestaLocal = { cuerpo: maestro('2026-07-31', ['A']) };
  await app.cargarModulos();
  assert.equal(app.rot.modulos.length, 2);
  assert.equal(app.rot.maestro.origen, 'servidor');
  assert.equal(app.rot.maestro.generado, '2026-08-04');
});

await prueba('el del servidor queda guardado para la proxima', async () => {
  const app = crear();
  respuestaDeRed = { cuerpo: maestro('2026-08-04', ['A', 'B']) };
  respuestaLocal = { cuerpo: maestro('2026-07-31', ['A']) };
  await app.cargarModulos();
  const guardado = JSON.parse(app.almacen['nfc_maestro_cache']);
  assert.equal(guardado.datos.generado, '2026-08-04');
  assert.ok(guardado.guardado, 'sin la fecha de guardado no se puede decir cuan viejo es');
});

await prueba('sin senal tira de lo guardado, no de lo del APK', async () => {
  const app = crear();
  app.almacen['nfc_maestro_cache'] = JSON.stringify({
    guardado: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    datos: maestro('2026-08-03', ['A', 'B', 'C']),
  });
  respuestaDeRed = null;
  respuestaLocal = { cuerpo: maestro('2026-07-31', ['A']) };
  await app.cargarModulos();
  assert.equal(app.rot.modulos.length, 3);
  assert.equal(app.rot.maestro.origen, 'cache');
  assert.match(app.procedenciaMaestro(), /guardado hace 2 d/);
});

await prueba('sin senal y sin guardado, el del APK', async () => {
  const app = crear();
  respuestaDeRed = null;
  respuestaLocal = { cuerpo: maestro('2026-07-31', ['A']) };
  await app.cargarModulos();
  assert.equal(app.rot.maestro.origen, 'app');
  assert.match(app.procedenciaMaestro(), /el de la app/);
});

await prueba('si todo falla no se inventa una lista', async () => {
  const app = crear();
  respuestaDeRed = null;
  respuestaLocal = null;
  await app.cargarModulos();
  assert.deepEqual(app.rot.modulos, []);
  assert.match(app.DOM.rotModuloHint.textContent, /No se pudo cargar/);
});

console.log('\n== respuestas malas del servidor ==');
await prueba('un maestro vacio del servidor NO sustituye al bueno', async () => {
  const app = crear();
  app.almacen['nfc_maestro_cache'] = JSON.stringify({
    guardado: new Date().toISOString(), datos: maestro('2026-08-03', ['A', 'B', 'C']),
  });
  respuestaDeRed = { cuerpo: { generado: '2026-08-04', modulos: [] } };
  respuestaLocal = { cuerpo: maestro('2026-07-31', ['A']) };
  await app.cargarModulos();
  assert.equal(app.rot.modulos.length, 3, 'debe caer a lo guardado, no aceptar la lista vacia');
  assert.equal(app.rot.maestro.origen, 'cache');
});

await prueba('un 500 del servidor no rompe nada', async () => {
  const app = crear();
  respuestaDeRed = { status: 500 };
  respuestaLocal = { cuerpo: maestro('2026-07-31', ['A']) };
  await app.cargarModulos();
  assert.equal(app.rot.maestro.origen, 'app');
});

await prueba('una respuesta mala no ensucia lo ya guardado', async () => {
  const app = crear();
  const bueno = JSON.stringify({ guardado: new Date().toISOString(), datos: maestro('2026-08-03', ['A']) });
  app.almacen['nfc_maestro_cache'] = bueno;
  respuestaDeRed = { cuerpo: { modulos: 'no soy una lista' } };
  respuestaLocal = { cuerpo: maestro('2026-07-31', ['A']) };
  await app.cargarModulos();
  assert.equal(app.almacen['nfc_maestro_cache'], bueno, 'solo se guarda lo que ya paso el filtro');
});

console.log('\n== modulos que salen del maestro ==');
await prueba('avisa si sale uno CON etiquetas grabadas', async () => {
  const app = crear();
  respuestaDeRed = { cuerpo: maestro('2026-08-03', ['A', 'B']) };
  respuestaLocal = { cuerpo: maestro('2026-07-31', ['A']) };
  await app.cargarModulos();
  app.rot.progreso['B'] = { pasadas: { 1: { 1: { texto: 'B-001', fecha: 'x' } } } };
  respuestaDeRed = { cuerpo: maestro('2026-08-04', ['A']) };
  await app.cargarModulos();
  assert.equal(app.avisos.length, 1, 'desaparecer en silencio es lo que no puede pasar');
  assert.match(app.avisos[0].m, /B/);
});

await prueba('no avisa si el que sale no tenia nada', async () => {
  const app = crear();
  respuestaDeRed = { cuerpo: maestro('2026-08-03', ['A', 'B']) };
  respuestaLocal = { cuerpo: maestro('2026-07-31', ['A']) };
  await app.cargarModulos();
  respuestaDeRed = { cuerpo: maestro('2026-08-04', ['A']) };
  await app.cargarModulos();
  assert.equal(app.avisos.length, 0, 'retirar un modulo vacio es normal y no merece ruido');
});

console.log(`\n${ok} pruebas pasadas, ${mal} fallidas\n`);
process.exit(mal ? 1 : 0);
