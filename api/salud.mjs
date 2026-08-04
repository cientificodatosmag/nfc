/**
 * Sonda de estado.
 *
 * Sirve para que la app distinga dos cosas que se parecen y no son lo mismo:
 * "no hay senal en el modulo" y "el servidor esta caido". Con esa diferencia el
 * operador sabe si tiene que moverse o si simplemente hay que esperar.
 *
 * Tambien devuelve la hora del servidor, que el cliente usa para corregir el
 * desfase de su propio reloj antes de firmar eventos.
 */
import { aplicarCors, verificarLlaveApp } from './_cors.mjs';
import { conectar } from './_db.mjs';

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return;
  if (!verificarLlaveApp(req, res)) return;

  const serverTime = new Date().toISOString();

  try {
    const sql = conectar();
    const [{ total }] = await sql`SELECT count(*)::int AS total FROM eventos`;
    return res.status(200).json({ ok: true, eventos: total, serverTime });
  } catch (err) {
    console.error('[salud]', err);
    // 503 y no 500: el servicio esta vivo, quien no responde es la base. La
    // hora se devuelve igual, que es lo unico que no depende de ella.
    return res.status(503).json({
      ok: false,
      error: String((err && err.message) || err),
      serverTime,
    });
  }
}
