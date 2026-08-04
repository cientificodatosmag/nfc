/**
 * Reinicia el avance de un modulo para TODOS los telefonos.
 *
 *   POST /api/reset
 *   { "modulo": "OOC-MNA-001", "pasada": 1|2|null, "confirmacion": "OOC-MNA-001",
 *     "motivo": "se mojaron las etiquetas" }
 *
 * Tres decisiones que conviene no deshacer sin pensarlo:
 *
 * 1. No borra nada. Anade un evento 'reset' que actua de barrera temporal: la
 *    proyeccion descarta lo anterior a esa fecha y las filas siguen ahi. Si el
 *    reinicio fue un error, se ve entero en la tabla mirando recibido_en.
 *
 * 2. La marca de tiempo la pone el SERVIDOR, no quien llama. Con la del cliente,
 *    un telefono con el reloj adelantado podria borrar trabajo que aun no se ha
 *    hecho, y con uno atrasado el reinicio no surtiria efecto. Es la unica
 *    fecha del sistema que no puede venir de fuera.
 *
 * 3. Exige la llave de ADMINISTRADOR, que nunca viaja en el APK. Un reinicio
 *    puede mandar a rotular de nuevo un modulo entero: que la llave que se
 *    puede sacar del APK no alcance para esto es justo el motivo de que sean
 *    dos llaves distintas.
 */
import { aplicarCors, verificarLlaveAdmin } from './_cors.mjs';
import { conectar, proyectar, desdeFila } from './_db.mjs';

const RE_MODULO = /^[A-Z]{3}-[A-Z]{3}-\d{3}$/;

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return;
  if (!verificarLlaveAdmin(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Usa POST.' });
  }

  const cuerpo = req.body || {};
  const modulo = String(cuerpo.modulo || '').toUpperCase().trim();

  if (!RE_MODULO.test(modulo)) {
    return res.status(400).json({ error: 'Codigo de modulo invalido.' });
  }

  // Escribir el codigo otra vez. Es una friccion deliberada: el error que se
  // quiere evitar no es teclear mal, es reiniciar el modulo equivocado.
  if (String(cuerpo.confirmacion || '').toUpperCase().trim() !== modulo) {
    return res.status(400).json({
      error: 'Falta la confirmacion: repite el codigo del modulo en "confirmacion".',
    });
  }

  const pasada = cuerpo.pasada === null || cuerpo.pasada === undefined
    ? null
    : Number(cuerpo.pasada);
  if (pasada !== null && pasada !== 1 && pasada !== 2) {
    return res.status(400).json({ error: 'pasada debe ser 1, 2, o nada para las dos.' });
  }

  const motivo = String(cuerpo.motivo || '').slice(0, 200);
  const quien = String(cuerpo.quien || 'admin').slice(0, 80);

  try {
    const sql = conectar();

    // Cuanto se va a tapar, contado ANTES de escribir la barrera. Es lo que
    // permite responder "esto borro 34 etiquetas" en vez de un ok a secas.
    const previas = await sql`
      SELECT seq, evento_id, tipo, modulo, pasada, numero, texto, uid, fecha,
             dispositivo, total_pasada, region, responsable, finca
        FROM eventos WHERE modulo = ${modulo} ORDER BY seq
    `;
    const antes = proyectar(previas.map(desdeFila));
    const afectadas = antes.etiquetas.filter((e) => pasada === null || e.pasada === pasada);

    const ahora = new Date().toISOString();
    // Una barrera por pasada: el modelo no tiene una barrera "global" propia,
    // asi que reiniciar el modulo entero son dos eventos. Que sean dos y no uno
    // mantiene la proyeccion con una sola regla en vez de dos casos.
    const pasadas = pasada === null ? [1, 2] : [pasada];
    const eventos = pasadas.map((p) => ({
      id: `reset-${modulo}-p${p}-${Date.parse(ahora).toString(36)}`,
      pasada: p,
    }));

    const puestos = await sql`
      INSERT INTO eventos (evento_id, tipo, modulo, pasada, numero, texto, uid,
                           fecha, fecha_local, dispositivo, total_pasada, region,
                           responsable, finca)
      SELECT * FROM unnest(
        ${eventos.map((e) => e.id)}::text[],
        ${eventos.map(() => 'reset')}::text[],
        ${eventos.map(() => modulo)}::text[],
        ${eventos.map((e) => e.pasada)}::smallint[],
        ${eventos.map(() => 1)}::int[],
        ${eventos.map(() => '')}::text[],
        ${eventos.map(() => '')}::text[],
        ${eventos.map(() => ahora)}::timestamptz[],
        ${eventos.map(() => ahora)}::timestamptz[],
        ${eventos.map(() => `admin:${quien}`)}::text[],
        ${eventos.map(() => 0)}::int[],
        ${eventos.map(() => '')}::text[],
        ${eventos.map(() => motivo)}::text[],
        ${eventos.map(() => '')}::text[]
      )
      ON CONFLICT (evento_id) DO NOTHING
      RETURNING evento_id
    `;

    const [{ seq }] = await sql`SELECT COALESCE(max(seq), 0)::int AS seq FROM eventos`;

    return res.status(200).json({
      ok: true,
      modulo,
      pasadas,
      reiniciadas: afectadas.length,
      eventos: puestos.map((f) => f.evento_id),
      fecha: ahora,
      seq,
      nota: 'No se borro ninguna fila. Los telefonos lo veran al sincronizar.',
      serverTime: ahora,
    });
  } catch (err) {
    console.error('[reset]', err);
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
}
