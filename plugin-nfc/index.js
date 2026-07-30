/**
 * Lado JS del plugin.
 *
 * La app carga los scripts con <script src="...">, sin bundler, así que el
 * registro real se hace en nfc-bridge.js con Capacitor.registerPlugin('NfcNative').
 * Este archivo existe para que el paquete npm sea válido y para quien quiera
 * importarlo desde un bundler.
 */
const { registerPlugin } = require('@capacitor/core');

module.exports.NfcNative = registerPlugin('NfcNative');
