/**
 * Configuración del cliente.
 *
 * Este archivo se versiona con la llave VACÍA. El build la rellena en
 * www/config.js desde el secreto NFC_APP_KEY de GitHub, porque el repositorio
 * es público.
 *
 * Aun así, conviene decirlo sin rodeos: esa llave acaba dentro del APK y un
 * `unzip` la revela en diez segundos. No es un secreto, es un filtro contra
 * curiosos. Lo que protege el histórico es que la base solo crezca y que
 * borrar exija otra llave que nunca sale del servidor.
 *
 * Sin llave la app sigue funcionando: graba etiquetas y guarda el avance en el
 * teléfono, solo que no sincroniza.
 */
window.APP_CONFIG = {
  apiBase: 'https://nfc-two-psi.vercel.app',
  appKey: '',
  sincronizar: true
};
