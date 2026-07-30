/**
 * NFC BACKEND BRIDGE
 *
 * Unifica las dos formas de hablar con una etiqueta y expone a app.js un único
 * flujo de resultados normalizados:
 *
 *   nativo (APK)  -> plugin Capacitor NfcNative. Comandos crudos al chip:
 *                    contraseña de hardware real (PWD/PACK/AUTH0) en NTAG21x.
 *   web (PWA)     -> Web NFC (NDEFReader) en Chrome Android. Solo NDEF, así que
 *                    el "candado" es un registro MIME que la app respeta pero
 *                    que otras apps pueden sobrescribir.
 *
 * En ambos casos app.js recibe el mismo objeto de resultado:
 *
 *   { success, mode, uid, model, protected, unlocked, locked, records[], error }
 */
(function () {
  'use strict';

  const SALT = 'NFC_SALT_2026::';
  const LOCK_MIME = 'application/vnd.nfc-lock';

  const capacitor = window.Capacitor;
  const isNative = !!(
    capacitor &&
    typeof capacitor.isNativePlatform === 'function' &&
    capacitor.isNativePlatform() &&
    typeof capacitor.registerPlugin === 'function'
  );
  const hasWebNfc = 'NDEFReader' in window;

  const plugin = isNative ? capacitor.registerPlugin('NfcNative') : null;

  let listener = null;          // callback de app.js
  let nativeHandle = null;      // handle del addListener de Capacitor
  let webReader = null;
  let webController = null;
  let session = null;           // opciones del escaneo en curso

  function emit(result) {
    if (listener) {
      listener(result);
    }
  }

  async function hashPassword(password) {
    const data = new TextEncoder().encode(SALT + password);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ------------------------------------------------------------------
  // Backend nativo
  // ------------------------------------------------------------------

  async function startNative(options) {
    if (!nativeHandle) {
      nativeHandle = await plugin.addListener('nfcResult', (result) => {
        emit(normalizeNative(result));
      });
    }
    await plugin.startScan({
      mode: options.mode,
      password: options.password || '',
      content: options.content || '',
      fullWipe: options.fullWipe !== false,
      protectRead: options.protectRead === true
    });
  }

  function normalizeNative(result) {
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

  // ------------------------------------------------------------------
  // Backend Web NFC
  // ------------------------------------------------------------------

  function decodeWebRecords(message) {
    const records = [];
    const list = (message && message.records) || [];
    for (const record of list) {
      const item = {
        recordType: record.recordType || 'unknown',
        mediaType: record.mediaType || '',
        text: '',
        bytes: record.data ? record.data.byteLength : 0
      };
      if (record.data) {
        try {
          item.text = new TextDecoder(record.encoding || 'utf-8').decode(record.data);
        } catch (e) {
          item.text = `[${item.bytes} bytes binarios]`;
        }
      }
      records.push(item);
    }
    return records;
  }

  /** Busca el candado por software escrito por versiones anteriores de la app. */
  function findSoftLockHash(records) {
    for (const record of records) {
      if (record.mediaType === LOCK_MIME && record.text.startsWith('HASH:')) {
        return record.text.slice('HASH:'.length).trim();
      }
      if (record.text.startsWith('NFC_LOCK_V1:')) {
        return record.text.slice('NFC_LOCK_V1:'.length).trim();
      }
    }
    return null;
  }

  async function writeEmptyWeb(reader) {
    try {
      await reader.write({ records: [{ recordType: 'empty' }] }, { overwrite: true });
    } catch (e) {
      // Algunas versiones de Chromium rechazan el registro vacío.
      await reader.write({ records: [{ recordType: 'text', data: '' }] }, { overwrite: true });
    }
  }

  async function handleWebReading(event) {
    const uid = event.serialNumber || 'Desconocido';
    const records = decodeWebRecords(event.message);
    const base = {
      success: true,
      mode: session.mode,
      uid,
      model: 'Web NFC (sin acceso al chip)',
      protected: false,
      unlocked: false,
      locked: false,
      readProtected: false,
      empty: records.length === 0,
      wipedBytes: 0,
      records,
      note: '',
      error: ''
    };

    try {
      if (session.mode === 'read') {
        emit(base);
        return;
      }

      if (session.mode === 'format') {
        const lockHash = findSoftLockHash(records);
        base.protected = !!lockHash;
        if (lockHash) {
          if (!session.password) {
            throw new Error('Etiqueta protegida: escribe la contraseña para poder borrarla.');
          }
          if ((await hashPassword(session.password)) !== lockHash) {
            throw new Error('Contraseña incorrecta. Acceso denegado.');
          }
          base.unlocked = true;
        }
        await writeEmptyWeb(webReader);
        emit(base);
        return;
      }

      if (session.mode === 'protect') {
        const hash = await hashPassword(session.password);
        const text = (session.content || '').trim() || 'Etiqueta Protegida';
        await webReader.write(
          {
            records: [
              { recordType: 'text', data: text },
              {
                recordType: 'mime',
                mediaType: LOCK_MIME,
                data: new TextEncoder().encode(`HASH:${hash}`)
              }
            ]
          },
          { overwrite: true }
        );
        base.locked = true;
        base.note = 'Candado por software: Web NFC no puede escribir la contraseña del chip.';
        emit(base);
      }
    } catch (err) {
      base.success = false;
      base.error = err.message || String(err);
      emit(base);
    }
  }

  async function startWeb(options) {
    webController = new AbortController();
    webReader = new NDEFReader();

    try {
      // scan() debe llamarse dentro del gesto del usuario o el navegador
      // ni siquiera muestra el diálogo de permiso.
      await webReader.scan({ signal: webController.signal });
    } catch (err) {
      webController = null;
      webReader = null;
      if (err && err.name === 'NotAllowedError') {
        throw new Error(
          'Permiso NFC denegado. Esto es la PWA, no la APK. Revisa: ' +
            '1) que el NFC del teléfono esté encendido; ' +
            '2) Ajustes de Android > Aplicaciones > esta app (o Chrome) > Permisos > NFC. ' +
            'Si lo bloqueaste antes, Chrome lo recuerda y no vuelve a preguntar.'
        );
      }
      if (err && err.name === 'NotSupportedError') {
        throw new Error('Este navegador no admite Web NFC. Usa Chrome en Android o instala la APK.');
      }
      throw err;
    }

    webReader.addEventListener('reading', handleWebReading);
    webReader.addEventListener('readingerror', () => {
      emit({
        success: false,
        mode: options.mode,
        uid: 'Desconocido',
        model: 'Web NFC (sin acceso al chip)',
        protected: false,
        unlocked: false,
        locked: false,
        readProtected: false,
        empty: false,
        wipedBytes: 0,
        records: [],
        note: '',
        error: 'No se pudo leer la etiqueta.'
      });
    });
  }

  // ------------------------------------------------------------------
  // API pública
  // ------------------------------------------------------------------

  const backend = {
    kind: isNative ? 'native' : hasWebNfc ? 'web' : 'none',

    /** Solo el backend nativo puede escribir la contraseña real del chip. */
    hardwareLock: isNative,

    isAvailable() {
      if (isNative) {
        return plugin.isAvailable();
      }
      return Promise.resolve({ hasNfc: hasWebNfc, enabled: hasWebNfc });
    },

    onResult(callback) {
      listener = callback;
    },

    async start(options) {
      session = Object.assign({ mode: 'read', password: '', content: '' }, options);
      if (isNative) {
        await startNative(session);
      } else if (hasWebNfc) {
        await startWeb(session);
      } else {
        throw new Error('Este dispositivo no admite NFC en este modo.');
      }
    },

    async stop() {
      session = null;
      if (isNative) {
        try {
          await plugin.stopScan();
        } catch (e) {
          /* el escaneo ya estaba detenido */
        }
        return;
      }
      if (webController) {
        try {
          webController.abort();
        } catch (e) {
          /* ya abortado */
        }
        webController = null;
        webReader = null;
      }
    },

    /** Inyecta un resultado sintético (simulador de escritorio). */
    emit,

    hashPassword
  };

  window.NfcBackend = backend;
})();
