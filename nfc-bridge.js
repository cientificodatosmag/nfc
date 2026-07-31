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
   * Capacitor inyecta su puente en el <head> antes que estos scripts, pero si
   * por lo que sea llega tarde, esperarlo es preferible a decidir en falso que
   * no estamos en la APK.
   */
  function waitForCapacitor(timeoutMs) {
    return new Promise((resolve) => {
      if (window.Capacitor && typeof window.Capacitor.registerPlugin === 'function') {
        resolve(window.Capacitor);
        return;
      }
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (window.Capacitor && typeof window.Capacitor.registerPlugin === 'function') {
          clearInterval(timer);
          resolve(window.Capacitor);
        } else if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, 50);
    });
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
        protectRead: options.protectRead === true
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
    const capacitor = await waitForCapacitor(3000);

    if (!capacitor) {
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
        ? 'Un service worker estaba sirviendo la app en caché y bloqueaba el puente nativo. ' +
          'Se eliminó, pero la recarga no bastó: desinstala la APK e instálala de nuevo.'
        : 'Estás en la APK y no hay service worker, pero el puente de Capacitor no cargó. ' +
          'El problema está en la compilación, no en la caché.';
      console.warn('[NFC]', backend.reason);
      return backend;
    }

    try {
      plugin = capacitor.registerPlugin('NfcNative');
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
