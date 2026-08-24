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
  'reglaDe', 'pasadasDe', 'totalPorPasada', 'totalModulo', 'textoEtiqueta',
  'registroDe', 'etiquetasDe',
  'hechasEnPasada', 'hechasDe', 'pasadaCompleta', 'moduloCompleto',
  'siguientePendiente', 'siguienteObjetivo', 'uidYaUsado', 'idEvento', 'migrarV1', 'leerJson',
];

/**
 * Saca una constante de app.js tal cual esta escrita.
 *
 * Copiarlas aqui a mano seria peor que inutil: la regla de cada tipo de riego
 * -cuantas pasadas y cuantas etiquetas extra- es justo lo que hay que probar, y
 * una copia se quedaria diciendo que todo va bien mientras la app cambia.
 */
function constante(nombre) {
  const m = src.match(new RegExp(`\\n  const ${nombre} = `));
  assert.ok(m, `no se encontro la constante ${nombre} en app.js`);
  // Hasta el punto y coma que cierra la declaracion, contando llaves: la tabla
  // de reglas por tipo ya no cabe en una linea y no va a encoger. Leer solo la
  // primera linea dejaria aqui media constante y un error de sintaxis, que es
  // peor que un fallo de prueba porque no dice cual es el problema.
  let nivel = 0;
  for (let j = m.index + m[0].length; j < src.length; j++) {
    if (src[j] === '{') nivel++;
    else if (src[j] === '}') nivel--;
    else if (src[j] === ';' && nivel === 0) return src.slice(m.index, j + 1);
  }
  throw new Error(`no se pudo cerrar la constante ${nombre}`);
}

const CONSTANTES = [
  'ETIQUETAS_EXTRA', 'PASADAS', 'MAX_PASADAS', 'REGLA_POR_DEFECTO',
  'REGLA_POR_TIPO', 'CODIGO_MODULO',
];

// Entorno minimo que esas funciones esperan.
const preludio = `
  ${CONSTANTES.map(constante).join('\n')}
  const ROT_PROGRESO_KEY = 'nfc_rotulado_progreso';
  const ROT_PROGRESO_V2_KEY = 'nfc_rotulado_progreso_v2';
  const ROT_MIGRACION_KEY = 'nfc_rotulado_migracion_v2';
  const rot = { progreso: {}, pasada: 1, indice: 0, seleccion: null, migracionFallida: '' };
  const almacen = {};
  const localStorage = {
    getItem: (k) => (k in almacen ? almacen[k] : null),
    setItem: (k, v) => { almacen[k] = String(v); },
  };
  const window = {};
  function dispositivoId() { return 'd-prueba'; }
  function guardarClave(k, v) { almacen[k] = String(v); return true; }
  function showToast() {}
  const console = { log() {}, error() {}, warn() {} };
`;

const cuerpo = preludio + FUNCIONES.map(extraer).join('\n');
const api = new Function(`${cuerpo}
  return { rot, almacen, reglaDe, pasadasDe, totalPorPasada, totalModulo,
           textoEtiqueta, etiquetasDe,
           hechasEnPasada, hechasDe, pasadaCompleta, moduloCompleto,
           siguientePendiente, siguienteObjetivo, uidYaUsado, idEvento, migrarV1 };`)();

const {
  rot, almacen, reglaDe, pasadasDe, totalPorPasada, totalModulo, textoEtiqueta,
  hechasEnPasada, hechasDe,
  pasadaCompleta, moduloCompleto, siguientePendiente, siguienteObjetivo, uidYaUsado,
  idEvento, migrarV1,
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

// Aspersion: seis etiquetas fijas y una sola pasada. Los ramales no cuentan,
// por eso este de prueba tiene 2 y sigue llevando 6.
const ASP = { codigo: 'OOC-ASP-001', ramales: 2, finca: 'F', region: 'R', responsable: 'X' };

function grabarEn(codigo, pasada, numeros, uidBase = 'U') {
  rot.progreso[codigo] = rot.progreso[codigo] || { pasadas: {} };
  const r = rot.progreso[codigo];
  r.pasadas[pasada] = r.pasadas[pasada] || {};
  numeros.forEach((n) => {
    r.pasadas[pasada][n] = {
      texto: textoEtiqueta(codigo, n), uid: `${uidBase}${pasada}-${n}`,
      fecha: '2026-08-03T00:00:00Z', dispositivo: 'd-prueba',
    };
  });
}

function grabar(pasada, numeros, uidBase = 'U') {
  grabarEn(MOD.codigo, pasada, numeros, uidBase);
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

console.log('\n== aspersion: un juego, seis fijas ==');
prueba('ASP lleva seis etiquetas, tenga los ramales que tenga', () => {
  assert.equal(totalPorPasada(ASP), 6, 'seis fijas, no dos por sus dos ramales');
  assert.equal(totalPorPasada({ ...ASP, ramales: 8 }), 6, 'ni ocho por sus ocho');
  assert.equal(pasadasDe(ASP), 1);
  assert.equal(totalModulo(ASP), 6, 'un solo juego de etiquetas');
});
prueba('la regla sale del codigo si el maestro no la trae', () => {
  // Es el caso del maestro dentro del APK, escrito antes de que ASP existiera:
  // sin esta deduccion mandaria a grabar 9 etiquetas por juego y dos juegos.
  assert.deepEqual(reglaDe({ codigo: 'OOC-ASP-009', ramales: 5 }),
    { pasadas: 1, extra: 0, fijas: 6 });
  assert.deepEqual(reglaDe({ codigo: 'OOC-MNA-009', ramales: 5 }),
    { pasadas: 2, extra: 4, fijas: null });
});
prueba('el maestro manda sobre la deduccion', () => {
  assert.deepEqual(
    reglaDe({ codigo: 'OOC-ASP-009', ramales: 5, pasadas: 2, etiquetasExtra: 4, etiquetasFijas: 9 }),
    { pasadas: 2, extra: 4, fijas: 9 }, 'para poder corregirlo sin reinstalar el APK');
  assert.equal(totalPorPasada({ codigo: 'OOC-ASP-009', ramales: 5, etiquetasFijas: 9 }), 9);
});
prueba('un valor imposible del maestro NO se obedece', () => {
  assert.deepEqual(
    reglaDe({ codigo: 'OOC-ASP-009', ramales: 5, pasadas: 0, etiquetasExtra: -1, etiquetasFijas: 0 }),
    { pasadas: 1, extra: 0, fijas: 6 }, 'cero etiquetas daria el modulo por hecho sin grabar nada');
  assert.deepEqual(reglaDe({ codigo: 'OOC-ASP-009', ramales: 5, pasadas: 7 }),
    { pasadas: 1, extra: 0, fijas: 6 }, 'el formato guardado no tiene mas de dos pasadas');
});
prueba('las fijas mandan sobre los ramales, no se suman', () => {
  assert.equal(totalPorPasada({ codigo: 'OOC-ASP-009', ramales: 5 }), 6,
    '5 ramales + 6 fijas serian 11: las fijas sustituyen la cuenta, no la amplian');
});
prueba('un codigo sin forma cae en la regla de siempre', () => {
  assert.deepEqual(reglaDe({ codigo: 'RARO', ramales: 3 }),
    { pasadas: 2, extra: 4, fijas: null });
  assert.equal(totalPorPasada({ codigo: 'RARO', ramales: 3 }), 7);
});
prueba('una sola pasada llena SI completa un ASP', () => {
  reset();
  grabarEn(ASP.codigo, 1, [1, 2, 3, 4, 5, 6]);
  assert.equal(pasadaCompleta(ASP, 1), true);
  assert.equal(moduloCompleto(ASP), true, 'no hay segunda pasada que esperar');
  assert.equal(siguienteObjetivo(ASP), null, 'y no puede mandar a empezar una pasada 2');
});
prueba('un ASP a medias sigue pendiente', () => {
  reset();
  grabarEn(ASP.codigo, 1, [1, 2]);
  assert.equal(moduloCompleto(ASP), false, 'dos de seis no es completo aunque tenga dos ramales');
  assert.deepEqual(siguienteObjetivo(ASP), { pasada: 1, numero: 3 });
});
prueba('etiquetas de una pasada 2 vieja se siguen viendo', () => {
  // Si a un modulo le bajaran las pasadas de 2 a 1, lo grabado en la 2 esta
  // pegado en el campo: contarlo es lo unico honesto.
  reset();
  grabarEn(ASP.codigo, 1, [1, 2]);
  grabarEn(ASP.codigo, 2, [1]);
  assert.equal(hechasDe(ASP.codigo), 3);
  assert.deepEqual(uidYaUsado(ASP.codigo, 'U2-1'), { pasada: 2, numero: 1 });
});
prueba('subir las etiquetas fijas descompleta un ASP ya lleno', () => {
  // El caso del cambio de regla: seis grabadas dejan de ser todas si mañana
  // piden ocho. El total sale del maestro vivo, nunca de lo guardado.
  reset();
  grabarEn(ASP.codigo, 1, [1, 2, 3, 4, 5, 6]);
  assert.equal(moduloCompleto(ASP), true);
  assert.equal(moduloCompleto({ ...ASP, etiquetasFijas: 8 }), false);
  assert.deepEqual(siguienteObjetivo({ ...ASP, etiquetasFijas: 8 }), { pasada: 1, numero: 7 });
});

console.log('\n== avance frontal y pivote: un juego, dos fijas ==');
// La maquina es una sola: dos etiquetas y una pasada. Los de prueba llevan
// ramales 0 a proposito, que es como entran muchos desde Oracle -nadie termino
// de llenarles el dato- y es justo el caso en el que la cuenta por ramales los
// habria dejado sin una sola etiqueta.
const AVF = { codigo: 'OOC-AVF-001', ramales: 0, finca: 'F', region: 'R', responsable: 'X' };
const PVC = { codigo: 'OOC-PVC-001', ramales: 0, finca: 'F', region: 'R', responsable: 'X' };

prueba('AVF y PVC llevan dos etiquetas en un solo juego', () => {
  for (const m of [AVF, PVC]) {
    assert.equal(totalPorPasada(m), 2, `${m.codigo}: dos fijas`);
    assert.equal(pasadasDe(m), 1, `${m.codigo}: una sola pasada`);
    assert.equal(totalModulo(m), 2, `${m.codigo}: dos etiquetas fisicas y ya`);
  }
});
prueba('sin ramales llenos siguen llevando sus dos', () => {
  assert.equal(totalPorPasada(AVF), 2, 'con ramales 0 la cuenta por ramales daria 4 de puro extra');
  assert.equal(totalPorPasada({ ...PVC, ramales: 12 }), 2, 'ni doce por sus doce');
});
prueba('la regla de AVF y PVC sale del codigo si el maestro no la trae', () => {
  // El maestro que viaja en el APK es anterior a estos dos tipos. Sin la
  // deduccion, un pivote tratado como MNA mandaria a grabar 4 x2 = 8 etiquetas.
  assert.deepEqual(reglaDe({ codigo: 'OOC-AVF-007', ramales: 0 }),
    { pasadas: 1, extra: 0, fijas: 2 });
  assert.deepEqual(reglaDe({ codigo: 'OOC-PVC-007', ramales: 0 }),
    { pasadas: 1, extra: 0, fijas: 2 });
});
prueba('las dos etiquetas completan un AVF', () => {
  reset();
  grabarEn(AVF.codigo, 1, [1, 2]);
  assert.equal(moduloCompleto(AVF), true, 'no hay segunda pasada que esperar');
  assert.equal(siguienteObjetivo(AVF), null);
});
prueba('un PVC con una sola etiqueta sigue pendiente', () => {
  reset();
  grabarEn(PVC.codigo, 1, [1]);
  assert.equal(moduloCompleto(PVC), false);
  assert.deepEqual(siguienteObjetivo(PVC), { pasada: 1, numero: 2 });
});

console.log('\n== carrete: dos juegos, pares exactos ==');
// El carrete se recorre ramal por ramal como la mini aspersion y tambien se
// graba dos veces, pero sin las cuatro de repuesto: un rotulo por ramal en cada
// juego. 6 ramales -> 6 por pasada, 12 fisicas.
const CAR = { codigo: 'OCR-CAR-001', ramales: 6, finca: 'F', region: 'R', responsable: 'X' };

prueba('CAR lleva un rotulo por ramal, sin las cuatro de repuesto', () => {
  assert.equal(totalPorPasada(CAR), 6, 'seis ramales, seis etiquetas: 10 seria MNA');
  assert.equal(pasadasDe(CAR), 2, 'dos juegos, igual que la mini aspersion');
  assert.equal(totalModulo(CAR), 12, 'seis por cada uno de los dos juegos');
});
prueba('la cuenta sigue a los ramales y no es fija', () => {
  // La diferencia con ASP, AVF y PVC: aqui los ramales SI mandan. Un carrete de
  // nueve ramales lleva nueve, no un numero pactado de antemano.
  assert.equal(totalPorPasada({ ...CAR, ramales: 9 }), 9);
  assert.equal(totalModulo({ ...CAR, ramales: 9 }), 18);
});
prueba('la regla de CAR sale del codigo si el maestro no la trae', () => {
  // Este es el caso que obliga a escribir CAR en la tabla en vez de dejarlo caer
  // en la regla por defecto: el maestro que viaja dentro del APK es anterior al
  // carrete y llega sin `etiquetasExtra`. Con el valor por defecto se le
  // sumarian las cuatro de MNA y el telefono pediria diez etiquetas para un
  // modulo de seis ramales.
  assert.deepEqual(reglaDe({ codigo: 'CEN-CAR-004', ramales: 8 }),
    { pasadas: 2, extra: 0, fijas: null });
  assert.equal(totalPorPasada({ codigo: 'CEN-CAR-004', ramales: 8 }), 8,
    'no 12: el carrete no hereda el extra de la mini aspersion');
});
prueba('la pasada 1 llena NO completa un carrete', () => {
  reset();
  grabarEn(CAR.codigo, 1, [1, 2, 3, 4, 5, 6]);
  assert.equal(pasadaCompleta(CAR, 1), true);
  assert.equal(moduloCompleto(CAR), false, 'falta el segundo juego');
  assert.deepEqual(siguienteObjetivo(CAR), { pasada: 2, numero: 1 },
    'y la 2 empieza por el 001, no sigue de largo');
});
prueba('los dos juegos llenos si lo completan', () => {
  reset();
  grabarEn(CAR.codigo, 1, [1, 2, 3, 4, 5, 6]);
  grabarEn(CAR.codigo, 2, [1, 2, 3, 4, 5, 6]);
  assert.equal(moduloCompleto(CAR), true);
  assert.equal(siguienteObjetivo(CAR), null);
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

console.log('\n== identificadores de evento ==');
prueba('el mismo dato da siempre el mismo id', () => {
  const a = idEvento('OOC-MNA-001', 1, 7, '2026-08-03T10:00:00Z', 'd-uno');
  const b = idEvento('OOC-MNA-001', 1, 7, '2026-08-03T10:00:00Z', 'd-uno');
  assert.equal(a, b, 'sin esto, reintentar una subida duplicaria filas');
});
prueba('dos telefonos en la misma etiqueta NO comparten id', () => {
  const a = idEvento('OOC-MNA-001', 1, 7, '2026-08-03T10:00:00Z', 'd-uno');
  const b = idEvento('OOC-MNA-001', 1, 7, '2026-08-03T10:00:00Z', 'd-dos');
  assert.notEqual(a, b,
    'compartirlo esconderia que hay DOS etiquetas fisicas con el mismo texto');
});
prueba('pasada y numero distinguen', () => {
  const p1 = idEvento('OOC-MNA-001', 1, 7, '2026-08-03T10:00:00Z', 'd-uno');
  const p2 = idEvento('OOC-MNA-001', 2, 7, '2026-08-03T10:00:00Z', 'd-uno');
  assert.notEqual(p1, p2);
});
prueba('cabe en los 120 caracteres que acepta el servidor', () => {
  const largo = idEvento('OOC-MNA-001', 2, 400,
    '2026-08-03T10:00:00Z', 'd-9f2a1c4e-8b7d-4a3f-9e2c-1d5b7a9c3e8f');
  assert.ok(largo.length <= 120, `mide ${largo.length}`);
});
prueba('migrar dos veces produce los MISMOS ids', () => {
  almacen['nfc_rotulado_progreso'] = JSON.stringify({
    'OOC-MNA-001': {
      etiquetas: { 1: { texto: 'OOC-MNA-001-001', uid: 'AA', fecha: '2026-07-01T10:00:00Z' } },
    },
  });
  delete almacen['nfc_rotulado_progreso_v2'];
  const uno = migrarV1()['OOC-MNA-001'].pasadas[1][1].id;
  delete almacen['nfc_rotulado_progreso_v2'];
  const otro = migrarV1()['OOC-MNA-001'].pasadas[1][1].id;
  assert.ok(uno, 'la migracion debe poner id');
  assert.equal(uno, otro, 'repetir la migracion no puede inventar eventos nuevos');
});

console.log(`\n${pasadas} pruebas pasadas, ${fallidas} fallidas\n`);
process.exit(fallidas ? 1 : 0);
