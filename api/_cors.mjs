/**
 * CORS y control de acceso compartido por todas las funciones.
 *
 * El APK vive en el origen https://localhost (esquema por defecto de Capacitor
 * 6 en Android), asi que TODA llamada es cross-origin. La cabecera propia
 * x-app-key obliga ademas a un preflight OPTIONS, y las cabeceras declaradas en
 * vercel.json no crean esa respuesta: la tiene que contestar cada funcion.
 *
 * Sobre las llaves, sin adornos: la de la app viaja dentro del APK, y un
 * `unzip` la revela en diez segundos. No es un secreto, es un filtro contra
 * curiosos y rastreadores. Lo que de verdad protege el dato es que la base sea
 * append-only y que borrar exija otra llave que nunca sale del servidor.
 */

const PERMITIDOS = new Set([
  'https://localhost',       // APK Android (Capacitor 6)
  'capacitor://localhost',   // iOS, si algun dia
  'http://localhost:3000',   // desarrollo
  'http://localhost:5173',
]);

/** El dominio propio del despliegue tambien vale, sea cual sea. */
function permitido(origen) {
  if (!origen) return false;
  if (PERMITIDOS.has(origen)) return true;
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origen);
}

export function aplicarCors(req, res) {
  const origen = req.headers.origin;

  if (permitido(origen)) {
    res.setHeader('Access-Control-Allow-Origin', origen);
  }
  // Sin esto, cada POST costaria dos viajes de red. En un enlace rural malo
  // eso se nota mucho mas que el propio tamano de los datos.
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-app-key, x-admin-key');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;   // ya contestado
  }
  return false;
}

/** Compara sin filtrar informacion por el tiempo que tarda. */
function iguales(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/**
 * Llave de la app: la que viaja en el APK. Da acceso de lectura y de escritura
 * de eventos, nada mas.
 */
export function verificarLlaveApp(req, res) {
  const esperada = process.env.NFC_APP_KEY;
  if (!esperada) {
    res.status(500).json({ error: 'El servidor no tiene configurada NFC_APP_KEY.' });
    return false;
  }
  if (!iguales(req.headers['x-app-key'] || '', esperada)) {
    res.status(401).json({ error: 'Llave de aplicacion invalida.' });
    return false;
  }
  return true;
}

/**
 * Llave de administrador: NO viaja en el APK. Hace falta para lo destructivo
 * (borrados) y para sacar el dato completo. Que sea distinta es lo que hace que
 * filtrar el APK no ponga en riesgo el historico.
 */
export function verificarLlaveAdmin(req, res) {
  const esperada = process.env.NFC_ADMIN_KEY;
  if (!esperada) {
    res.status(500).json({ error: 'El servidor no tiene configurada NFC_ADMIN_KEY.' });
    return false;
  }
  if (!iguales(req.headers['x-admin-key'] || '', esperada)) {
    res.status(401).json({ error: 'Llave de administrador invalida.' });
    return false;
  }
  return true;
}
