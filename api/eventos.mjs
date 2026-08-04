/**
 * El registro compartido de rotulado.
 *
 *   GET  /api/eventos?desde=<seq>&limite=<n>   baja lo nuevo desde un cursor
 *   POST /api/eventos                          sube un lote, de forma idempotente
 *
 * La subida se puede repetir sin miedo: la clave unica sobre evento_id hace que
 * un reintento no duplique filas. Por eso el cliente puede reintentar tras un
 * corte de red sin saber si la peticion anterior llego o no.
 */
import { aplicarCors, verificarLlaveApp } from './_cors.mjs';
import { conectar, desdeFila, validarEvento, LOTE_MAXIMO } from './_db.mjs';

const LIMITE_POR_DEFECTO = 1000;
const LIMITE_MAXIMO = 5000;

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return;
  if (!verificarLlaveApp(req, res)) return;

  try {
    const sql = conectar();
    if (req.method === 'GET') return await bajar(req, res, sql);
    if (req.method === 'POST') return await subir(req, res, sql);
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Metodo no permitido.' });
  } catch (err) {
    console.error('[eventos]', err);
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
}

async function bajar(req, res, sql) {
  const desde = Math.max(0, Number(req.query.desde) || 0);
  const limite = Math.min(LIMITE_MAXIMO, Math.max(1, Number(req.query.limite) || LIMITE_POR_DEFECTO));

  // Un solo flujo ordenado por seq para grabaciones y reinicios: asi el cursor
  // es uno y no hay ambiguedad sobre cual de los dos ocurrio antes.
  const filas = await sql`
    SELECT seq, evento_id, tipo, modulo, pasada, numero, texto, uid, fecha,
           dispositivo, total_pasada, region, responsable, finca
      FROM eventos
     WHERE seq > ${desde}
     ORDER BY seq
     LIMIT ${limite}
  `;

  const eventos = filas.map(desdeFila);
  const [{ total }] = await sql`SELECT count(*)::int AS total FROM eventos`;

  return res.status(200).json({
    eventos,
    siguienteCursor: eventos.length ? eventos[eventos.length - 1].seq : desde,
    hayMas: eventos.length === limite,
    total,
    serverTime: new Date().toISOString(),
  });
}

async function subir(req, res, sql) {
  const cuerpo = req.body || {};
  const entrada = Array.isArray(cuerpo.eventos) ? cuerpo.eventos : null;

  if (!entrada) {
    return res.status(400).json({ error: 'Falta el arreglo "eventos".' });
  }
  if (entrada.length > LOTE_MAXIMO) {
    return res.status(400).json({ error: `Lote demasiado grande: maximo ${LOTE_MAXIMO}.` });
  }
  if (entrada.length === 0) {
    const [{ seq }] = await sql`SELECT COALESCE(max(seq), 0)::int AS seq FROM eventos`;
    return res.status(200).json({
      aceptados: [], duplicados: [], rechazados: [], seq,
      serverTime: new Date().toISOString(),
    });
  }

  const validos = [];
  const rechazados = [];
  for (const bruto of entrada) {
    const r = validarEvento(bruto);
    if (r.ok) validos.push(r.evento);
    else rechazados.push({ id: String((bruto && bruto.id) || ''), motivo: r.motivo });
  }

  let insertados = [];
  if (validos.length) {
    // unnest deja el numero de parametros fijo sea cual sea el tamano del lote,
    // asi que una sola ida y vuelta basta.
    const filas = await sql`
      INSERT INTO eventos (evento_id, tipo, modulo, pasada, numero, texto, uid,
                           fecha, fecha_local, dispositivo, total_pasada,
                           region, responsable, finca)
      SELECT * FROM unnest(
        ${validos.map((e) => e.id)}::text[],
        ${validos.map((e) => e.tipo)}::text[],
        ${validos.map((e) => e.modulo)}::text[],
        ${validos.map((e) => e.pasada)}::smallint[],
        ${validos.map((e) => e.numero)}::int[],
        ${validos.map((e) => e.texto)}::text[],
        ${validos.map((e) => e.uid)}::text[],
        ${validos.map((e) => e.fecha)}::timestamptz[],
        ${validos.map((e) => e.fechaLocal)}::timestamptz[],
        ${validos.map((e) => e.dispositivo)}::text[],
        ${validos.map((e) => e.totalPasada)}::int[],
        ${validos.map((e) => e.region)}::text[],
        ${validos.map((e) => e.responsable)}::text[],
        ${validos.map((e) => e.finca)}::text[]
      )
      ON CONFLICT (evento_id) DO NOTHING
      RETURNING evento_id
    `;
    insertados = filas.map((f) => f.evento_id);
  }

  // Lo que no entro y no fue rechazado ya estaba: para el cliente cuenta igual
  // que aceptado, y por eso puede sacarlo de la cola sin perderlo.
  const puestos = new Set(insertados);
  const duplicados = validos.filter((e) => !puestos.has(e.id)).map((e) => e.id);

  const [{ seq }] = await sql`SELECT COALESCE(max(seq), 0)::int AS seq FROM eventos`;

  return res.status(200).json({
    aceptados: insertados,
    duplicados,
    rechazados,
    seq,
    serverTime: new Date().toISOString(),
  });
}
