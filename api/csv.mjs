/**
 * Exportacion del registro completo, para la oficina.
 *
 *   GET /api/csv                -> una fila por etiqueta grabada
 *   GET /api/csv?vista=resumen  -> una fila por modulo
 *   GET /api/csv?modulo=OOC-MNA-001
 *
 * Existe aparte del boton de la app por una razon concreta: el telefono exporta
 * lo que ese telefono tiene, que es correcto pero parcial si alguno lleva dias
 * sin sincronizar. Esto exporta lo que hay en la base, que es la version
 * compartida.
 *
 * Va detras de la llave de ADMINISTRADOR aunque solo lea: saca de una vez todos
 * los nombres de responsables y fincas, y esa llave no viaja en el APK.
 */
import { aplicarCors, verificarLlaveAdmin } from './_cors.mjs';
import { conectar, proyectar, desdeFila } from './_db.mjs';
import {
  aCsv, CABECERA_DETALLE, CABECERA_RESUMEN, filasDetalle, filasResumen,
} from './_csv.mjs';

const RE_MODULO = /^[A-Z]{3}-[A-Z]{3}-\d{3}$/;

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return;
  if (!verificarLlaveAdmin(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Usa GET.' });
  }

  const resumen = String(req.query.vista || '') === 'resumen';
  const modulo = String(req.query.modulo || '').toUpperCase().trim();
  if (modulo && !RE_MODULO.test(modulo)) {
    return res.status(400).json({ error: 'Codigo de modulo invalido.' });
  }

  try {
    const sql = conectar();

    // Se traen TODOS los eventos del modulo (o de todos) y se proyecta aqui.
    // Filtrar en SQL por "lo vigente" obligaria a reimplementar en SQL las
    // barreras de reinicio y el last-write-wins, y dos versiones de esa regla
    // es exactamente lo que este proyecto evita en todas partes.
    const filas = modulo
      ? await sql`
          SELECT seq, evento_id, tipo, modulo, pasada, numero, texto, uid, fecha,
                 dispositivo, total_pasada, region, responsable, finca
            FROM eventos WHERE modulo = ${modulo} ORDER BY seq`
      : await sql`
          SELECT seq, evento_id, tipo, modulo, pasada, numero, texto, uid, fecha,
                 dispositivo, total_pasada, region, responsable, finca
            FROM eventos ORDER BY seq`;

    const { etiquetas, duplicados } = proyectar(filas.map(desdeFila));

    const csv = resumen
      ? aCsv(CABECERA_RESUMEN, filasResumen(etiquetas, duplicados))
      : aCsv(CABECERA_DETALLE, filasDetalle(etiquetas, duplicados));

    const nombre = `rotulado_${resumen ? 'resumen' : 'detalle'}`
      + `${modulo ? `_${modulo}` : ''}_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.setHeader('X-Etiquetas', String(etiquetas.length));
    res.setHeader('X-Duplicados', String(duplicados.length));
    return res.status(200).send(csv);
  } catch (err) {
    console.error('[csv]', err);
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
}
