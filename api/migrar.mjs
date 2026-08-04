/**
 * Crea el esquema. Se corre a mano una vez, con la llave de administrador.
 *
 * A proposito NO se ejecuta el DDL en cada arranque en frio: seria una orden de
 * definicion en cada peticion, y una tabla que se crea sola esconde el momento
 * en que el esquema cambia. Aqui queda explicito y con fecha.
 *
 *   curl -X POST https://<proyecto>.vercel.app/api/migrar -H "x-admin-key: ..."
 */
import { aplicarCors, verificarLlaveAdmin } from './_cors.mjs';
import { conectar } from './_db.mjs';

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return;
  if (!verificarLlaveAdmin(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Usa POST.' });
  }

  try {
    const sql = conectar();

    // seq: cursor de sincronizacion, lo da la base y siempre crece.
    // evento_id unico: es TODA la idempotencia. Sin esta restriccion, un
    //   reintento tras un corte de red duplicaria la etiqueta.
    // No hay UPDATE ni DELETE en ninguna funcion: el log solo crece, asi que
    //   cualquier destrozo se puede deshacer mirando recibido_en.
    await sql`
      CREATE TABLE IF NOT EXISTS eventos (
        seq           bigserial PRIMARY KEY,
        evento_id     text        NOT NULL UNIQUE,
        tipo          text        NOT NULL DEFAULT 'grabada',
        modulo        text        NOT NULL,
        pasada        smallint    NOT NULL,
        numero        integer     NOT NULL,
        texto         text        NOT NULL DEFAULT '',
        uid           text        NOT NULL DEFAULT '',
        fecha         timestamptz NOT NULL,
        fecha_local   timestamptz,
        recibido_en   timestamptz NOT NULL DEFAULT now(),
        dispositivo   text        NOT NULL,
        total_pasada  integer     NOT NULL DEFAULT 0,
        region        text,
        responsable   text,
        finca         text
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS eventos_clave ON eventos (modulo, pasada, numero)`;
    await sql`CREATE INDEX IF NOT EXISTS eventos_dispositivo ON eventos (dispositivo)`;
    await sql`CREATE INDEX IF NOT EXISTS eventos_recibido ON eventos (recibido_en)`;

    const [{ total }] = await sql`SELECT count(*)::int AS total FROM eventos`;
    const columnas = await sql`
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'eventos' ORDER BY ordinal_position
    `;

    return res.status(200).json({
      ok: true,
      mensaje: 'Esquema listo.',
      eventos: total,
      columnas: columnas.map((c) => `${c.column_name} ${c.data_type}`),
    });
  } catch (err) {
    console.error('[migrar]', err);
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
}
