/**
 * NFC BACKEND BRIDGE (solo APK nativa)
 *
 * Toda la conversación con la etiqueta ocurre en el plugin Capacitor
 * NfcNative: comandos crudos al chip, contraseña de hardware real en
 * NTAG213/215/216.
 *
 * Web NFC quedó fuera a propósito. El WebView de Android define NDEFReader
 * pero rechaza scan() con NotAllowedError, así que servía de respaldo silencioso
 * que solo conseguía disfrazar un fallo de arranque del puente nativo.
 *
 * app.js recibe siempre el mismo objeto de resultado:
 *
 *   { success, mode, uid, model, capacity, protected, unlocked, locked,
 *     readProtected, empty, wipedBytes, records[], note, error }
 */
(function () {
  'use strict';

  const RELOAD_FLAG = 'nfc_bridge_sw_purged';

  let listener = null;
  let plugin = null;
  let nativeHandle = null;

  function emit(result) {
    if (listener) {
      listener(result);
    }
  }

  /**
   * Devuelve una forma de obtener el plugin, o null si el puente aún no está.
   *
   * Se aceptan las dos vías: registerPlugin() la aporta native-bridge.js, y
   * Capacitor.Plugins es el acceso heredado. Si solo falta la primera, el
   * problema es que native-bridge.js no llegó al APK.
   */
  function getPluginFactory() {
    const cap = window.Capacitor;
    if (!cap) return null;
    if (typeof cap.registerPlugin === 'function') {
      return () => cap.registerPlugin('NfcNative');
    }
    if (cap.Plugins && cap.Plugins.NfcNative) {
      return () => cap.Plugins.NfcNative;
    }
    return null;
  }

  /**
   * Capacitor inyecta su puente en el <head> antes que estos scripts, pero si
   * por lo que sea llega tarde, esperarlo es preferible a decidir en falso que
   * no estamos en la APK.
   */
  function waitForCapacitor(timeoutMs) {
    return new Promise((resolve) => {
      const factory = getPluginFactory();
      if (factory) {
        resolve(factory);
        return;
      }
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const found = getPluginFactory();
        if (found) {
          clearInterval(timer);
          resolve(found);
        } else if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, 50);
    });
  }

  /**
   * Último recurso: si la inyección del puente no ocurrió, cargar
   * native-bridge.js por URL. El interfaz nativo (androidBridge) lo pone el
   * WebView, así que el script funciona igual cargado desde aquí.
   */
  function loadScript(src) {
    return new Promise((resolve) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => resolve(true);
      el.onerror = () => resolve(false);
      document.head.appendChild(el);
    });
  }

  /** Qué hay realmente en window.Capacitor, para no diagnosticar a ciegas. */
  function describeCapacitorGlobal() {
    const cap = window.Capacitor;
    if (!cap) {
      return 'window.Capacitor NO existe: la inyección del puente no ocurrió.';
    }
    let keys;
    try {
      keys = Object.keys(cap).join(', ') || '(sin propiedades)';
    } catch (e) {
      keys = '(ilegible)';
    }
    return `window.Capacitor SÍ existe pero sin registerPlugin — falta native-bridge.js. Propiedades: ${keys}.`;
  }

  function normalize(result) {
    return {
      success: result.success === true,
      mode: result.mode || 'read',
      uid: result.uid || 'Desconocido',
      model: result.model || 'Desconocida',
      capacity: result.capacity || 0,
      protected: result.protected === true,
      unlocked: result.unlocked === true,
      locked: result.locked === true,
      readProtected: result.readProtected === true,
      contentKept: result.contentKept === true,
      empty: result.empty === true,
      wipedBytes: result.wipedBytes || 0,
      records: result.records || [],
      note: result.note || '',
      error: result.error || ''
    };
  }

  const backend = {
    kind: 'none',       // 'native' | 'none'
    hardwareLock: false,
    status: null,       // { hasNfc, enabled }
    reason: '',         // por qué no hay backend nativo, si es el caso
    isApkOrigin: false, // servido por el WebView de Capacitor

    onResult(callback) {
      listener = callback;
    },

    async start(options) {
      if (backend.kind !== 'native') {
        throw new Error(backend.reason || 'El puente NFC nativo no está disponible.');
      }
      if (!nativeHandle) {
        nativeHandle = await plugin.addListener('nfcResult', (result) => emit(normalize(result)));
      }
      await plugin.startScan({
        mode: options.mode,
        password: options.password || '',
        content: options.content || '',
        fullWipe: options.fullWipe !== false,
        protectRead: options.protectRead === true,
        lockOnly: options.lockOnly !== false
      });
    },

    async stop() {
      if (backend.kind !== 'native') return;
      try {
        await plugin.stopScan();
      } catch (e) {
        /* el escaneo ya estaba detenido */
      }
    },

    /** Inyecta un resultado sintético (simulador de escritorio). */
    emit
  };

  /** Orígenes que usa el WebView de Capacitor. Si estamos aquí, es la APK. */
  function looksLikeApk() {
    return (
      /^(capacitor|ionic):$/.test(window.location.protocol) ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
  }

  /**
   * Un service worker registrado por versiones anteriores sirve el index.html
   * desde caché y se salta la inyección del puente de Capacitor, dejando la APK
   * sin acceso nativo de forma permanente. Se limpia sin preguntar.
   */
  async function purgeServiceWorkers() {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }
      if (window.caches && caches.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      console.warn('[NFC] No se pudo limpiar el service worker:', e);
    }
  }

  /**
   * La detección no se fía de isNativePlatform(): la prueba de verdad es que el
   * plugin conteste. Si contesta, estamos en la APK con el plugin enlazado.
   */
  backend.ready = (async function detect() {
    backend.isApkOrigin = looksLikeApk();

    let pluginFactory = await waitForCapacitor(2000);
    let rescue = '';

    // Si el puente no se inyectó, intentar cargarlo por URL antes de rendirse.
    if (!pluginFactory && backend.isApkOrigin) {
      const loaded = await loadScript('native-bridge.js');
      rescue = loaded
        ? ' Se cargó native-bridge.js a mano'
        : ' No se pudo descargar native-bridge.js';
      if (loaded) {
        pluginFactory = await waitForCapacitor(2000);
        rescue += pluginFactory ? ' y el puente respondió.' : ' pero el puente siguió sin aparecer.';
      } else {
        rescue += ' (no está empaquetado).';
      }
      console.warn('[NFC] Rescate del puente:' + rescue);
    }

    if (!pluginFactory) {
      backend.kind = 'none';

      if (!backend.isApkOrigin) {
        backend.reason = 'No se encontró el puente de Capacitor: esto no es la APK, es el navegador.';
        console.warn('[NFC]', backend.reason);
        return backend;
      }

      // ¿Nos está sirviendo un service worker? Es la prueba, no la sospecha.
      const controlledBySw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
      await purgeServiceWorkers();

      // Recargar una sola vez: ya sin service worker, el HTML vuelve a venir
      // del servidor de Capacitor, que es quien inyecta el puente.
      if (controlledBySw && !sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1');
        console.warn('[NFC] Service worker eliminado. Recargando para recuperar el puente nativo.');
        window.location.reload();
        return backend;
      }

      backend.reason = controlledBySw
        ? 'Un service worker bloqueaba el puente nativo. Se eliminó, pero la recarga no bastó: ' +
          'desinstala la APK e instálala de nuevo.'
        : 'Sin service worker y sin puente nativo, el fallo está en el APK. ' +
          describeCapacitorGlobal() +
          rescue;
      console.warn('[NFC]', backend.reason);
      return backend;
    }

    try {
      plugin = pluginFactory();
      backend.status = await plugin.isAvailable();
      backend.kind = 'native';
      backend.hardwareLock = true;
      console.log('[NFC] Backend nativo listo:', backend.status);
    } catch (err) {
      backend.kind = 'none';
      backend.reason = 'El plugin NfcNative no respondió: ' + (err && err.message ? err.message : err);
      console.error('[NFC]', backend.reason, err);
    }

    return backend;
  })();

  window.NfcBackend = backend;
})();
