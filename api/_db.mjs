/**
 * Acceso a la base y reglas del registro de rotulado.
 *
 * El modelo es un log append-only: nunca se actualiza ni se borra una fila. Lo
 * que ve la app es una PROYECCION calculada sobre ese log, reconstruible desde
 * cero en cualquier momento. Esa propiedad es la que permite que dos telefonos
 * que trabajaron sin senal converjan al mismo resultado, y la que hace que un
 * error sea siempre recuperable con SQL.
 */
import { neon } from '@neondatabase/serverless';

/** La integracion de Neon en Vercel deja la cadena en una de estas dos. */
export function conectar() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error('Falta DATABASE_URL (o POSTGRES_URL) en el entorno.');
  }
  return neon(url);
}

export const LOTE_MAXIMO = 200;

const RE_MODULO = /^[A-Z]{3}-[A-Z]{3}-\d{3}$/;
const RE_TEXTO = /^[A-Z0-9-]{1,32}$/;
const RE_UID = /^[0-9A-Fa-f:]{8,32}$/;

// La ventana es asimetrica a proposito.
//
// Una fecha en el FUTURO gana todos los desempates del last-write-wins, asi que
// un telefono con el reloj adelantado pisaria el trabajo de todos los demas: se
// tolera poco. Una fecha en el PASADO solo pierde desempates, que es inofensivo,
// y ademas es lo que traen los eventos migrados del avance que ya estaba grabado
// en los telefonos antes de existir el registro compartido. Rechazarlos por
// viejos habria dejado fuera justo el historico que se quiere recuperar.
const FUTURO_MAXIMO = 2 * 24 * 60 * 60 * 1000;
const PASADO_MAXIMO = 2 * 365 * 24 * 60 * 60 * 1000;

function recortar(valor, largo) {
  if (valor === null || valor === undefined) return '';
  return String(valor).slice(0, largo);
}

/**
 * Valida un evento. Devuelve {ok, motivo, evento}.
 *
 * Se rechaza, no se sanea: un evento mal formado es un error del cliente que
 * conviene ver, no maquillar. Ademas es la primera barrera contra inyeccion,
 * porque los campos con formato estricto no pueden llevar HTML.
 */
export function validarEvento(bruto) {
  if (!bruto || typeof bruto !== 'object') {
    return { ok: false, motivo: 'no es un objeto' };
  }

  const id = String(bruto.id || '');
  if (!id || id.length > 120) {
    return { ok: false, motivo: 'id ausente o demasiado largo' };
  }

  const tipo = bruto.tipo === 'reset' ? 'reset' : 'grabada';
  const modulo = String(bruto.modulo || '').toUpperCase();
  if (!RE_MODULO.test(modulo)) {
    return { ok: false, motivo: `modulo invalido: ${recortar(modulo, 40)}` };
  }

  const pasada = Number(bruto.pasada);
  if (!Number.isInteger(pasada) || pasada < 1 || pasada > 2) {
    return { ok: false, motivo: 'pasada debe ser 1 o 2' };
  }

  const numero = Number(bruto.numero);
  if (!Number.isInteger(numero) || numero < 1 || numero > 400) {
    return { ok: false, motivo: 'numero fuera de 1..400' };
  }

  const texto = String(bruto.texto || '').toUpperCase();
  if (tipo === 'grabada' && !RE_TEXTO.test(texto)) {
    return { ok: false, motivo: `texto invalido: ${recortar(texto, 40)}` };
  }

  const uid = String(bruto.uid || '');
  if (uid && !RE_UID.test(uid)) {
    return { ok: false, motivo: `uid invalido: ${recortar(uid, 40)}` };
  }

  const fecha = new Date(bruto.fecha);
  if (Number.isNaN(fecha.getTime())) {
    return { ok: false, motivo: 'fecha ilegible' };
  }
  const desvio = fecha.getTime() - Date.now();
  if (desvio > FUTURO_MAXIMO) {
    return { ok: false, motivo: 'fecha en el futuro: revisa el reloj del telefono' };
  }
  if (-desvio > PASADO_MAXIMO) {
    return { ok: false, motivo: 'fecha de hace mas de dos anos: revisa el reloj del telefono' };
  }

  const dispositivo = String(bruto.dispositivoId || bruto.dispositivo || '');
  if (!dispositivo || dispositivo.length > 80) {
    return { ok: false, motivo: 'dispositivoId ausente o demasiado largo' };
  }

  const fechaLocal = new Date(bruto.fechaLocal || bruto.fecha);

  return {
    ok: true,
    evento: {
      id,
      tipo,
      modulo,
      pasada,
      numero,
      texto,
      uid,
      fecha: fecha.toISOString(),
      fechaLocal: Number.isNaN(fechaLocal.getTime()) ? fecha.toISOString() : fechaLocal.toISOString(),
      dispositivo,
      totalPasada: Number.isInteger(Number(bruto.totalPasada)) ? Number(bruto.totalPasada) : 0,
      region: recortar(bruto.region, 120),
      responsable: recortar(bruto.responsable, 120),
      finca: recortar(bruto.finca, 120),
    },
  };
}

/**
 * Reduce el log a "que hay grabado ahora mismo".
 *
 * Es conmutativa e idempotente: dos aparatos que hayan visto el mismo conjunto
 * de eventos producen la misma salida sin importar en que orden llegaron. Sin
 * esa propiedad, dos telefonos sincronizando no convergerian.
 *
 * Reglas:
 *  - Un 'reset' pone una barrera temporal; todo lo anterior a ella se descarta.
 *  - Entre dos escrituras de la misma clave gana la de fecha mayor, y a igual
 *    fecha la de id mayor. Nunca el orden de llegada, que es distinto en cada
 *    telefono.
 *  - Si dos dispositivos escribieron la misma clave, se marca 'duplicado': eso
 *    significa que existen DOS etiquetas fisicas con el mismo texto, y esconderlo
 *    dejaria una circulando sin registro.
 */
export function proyectar(eventos) {
  const barreras = new Map();   // modulo -> { global, 1, 2 }
  const mejor = new Map();      // "modulo|pasada|numero" -> evento
  const duplicados = new Set();

  const barreraDe = (modulo) => {
    if (!barreras.has(modulo)) barreras.set(modulo, { global: null, 1: null, 2: null });
    return barreras.get(modulo);
  };

  for (const e of eventos) {
    if (e.tipo !== 'reset') continue;
    const b = barreraDe(e.modulo);
    const clave = e.pasada === 1 || e.pasada === 2 ? e.pasada : 'global';
    if (!b[clave] || e.fecha > b[clave]) b[clave] = e.fecha;
  }

  for (const e of eventos) {
    if (e.tipo === 'reset') continue;
    const clave = `${e.modulo}|${e.pasada}|${e.numero}`;
    const previo = mejor.get(clave);
    if (previo && previo.dispositivo !== e.dispositivo) duplicados.add(clave);
    if (!previo || e.fecha > previo.fecha || (e.fecha === previo.fecha && e.id > previo.id)) {
      mejor.set(clave, e);
    }
  }

  for (const [clave, e] of [...mejor]) {
    const b = barreras.get(e.modulo);
    if (!b) continue;
    const corte = [b.global, b[e.pasada]].filter(Boolean).sort().pop();
    if (corte && e.fecha <= corte) mejor.delete(clave);
  }

  // Un duplicado sobre una clave que un reinicio borro ya no describe nada que
  // este registrado, asi que no se arrastra. La proyeccion cuenta lo que hay
  // ahora, y ademas el cliente no podria reproducir una marca sobre una
  // etiqueta que ya no tiene guardada.
  return {
    etiquetas: [...mejor.values()],
    duplicados: [...duplicados].filter((c) => mejor.has(c)),
  };
}

/** Filas de la base -> forma que usa proyectar() y devuelve la API. */
export function desdeFila(fila) {
  return {
    seq: Number(fila.seq),
    id: fila.evento_id,
    tipo: fila.tipo,
    modulo: fila.modulo,
    pasada: Number(fila.pasada),
    numero: Number(fila.numero),
    texto: fila.texto,
    uid: fila.uid,
    fecha: new Date(fila.fecha).toISOString(),
    dispositivo: fila.dispositivo,
    totalPasada: Number(fila.total_pasada),
    region: fila.region || '',
    responsable: fila.responsable || '',
    finca: fila.finca || '',
  };
}
