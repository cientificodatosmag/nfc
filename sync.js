/**
 * Sincronización del registro de rotulado.
 *
 * Este archivo es SOLO transporte: cola, reintentos, cursor y reloj. No sabe
 * nada de la forma en que la app guarda el avance — eso lo resuelve app.js al
 * recibir los eventos. Así se puede razonar sobre la red sin arrastrar la UI, y
 * sobre la UI sin arrastrar la red.
 *
 * Reglas que rigen todo lo de abajo:
 *
 *  - Se sube ANTES de bajar. Si se hiciera al revés, lo que este teléfono
 *    grabó sin señal podría verse pisado por una versión vieja del servidor
 *    durante los segundos que van entre una cosa y la otra.
 *  - Un evento sale de la cola cuando el servidor lo acepta O lo declara
 *    duplicado. "Duplicado" significa "ya estaba", que es exactamente lo que
 *    queríamos: mantenerlo en la cola sería reintentar para siempre.
 *  - Un evento rechazado NO vuelve a la cola. Un solo evento mal formado
 *    bloquearía la subida de todos los demás, indefinidamente. Se aparta, se
 *    cuenta y se puede exportar.
 *  - La fecha de cada evento se corrige con el desfase del reloj del servidor.
 *    Sin eso, un teléfono con la hora mal puesta gana o pierde todos los
 *    empates del last-write-wins.
 *
 * Si no hay llave configurada, todo esto queda inerte y la app funciona igual
 * que antes: graba etiquetas y guarda el avance en el teléfono.
 */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};

  const COLA_KEY = 'nfc_eventos_pendientes';
  const CURSOR_KEY = 'nfc_sync_cursor';
  const APARTADOS_KEY = 'nfc_eventos_apartados';
  const DISPOSITIVO_KEY = 'nfc_dispositivo_id';

  const LOTE = 200;              // el máximo que acepta el servidor
  const LIMITE_BAJADA = 1000;
  const VUELTAS_MAXIMAS = 20;    // 20.000 eventos de un tirón: de sobra
  const ESPERAS = [5000, 15000, 60000, 300000];
  const DEBOUNCE_MS = 3000;
  const INTERVALO_MS = 60000;
  const TIMEOUT_MS = 15000;
  const COLA_MAXIMA = 5000;

  const estado = {
    configurado: Boolean(CFG.sincronizar && CFG.apiBase && CFG.appKey),
    sincronizando: false,
    llaveInvalida: false,
    ultimoError: '',
    ultimaSync: null,
    pendientes: 0,
    apartados: 0,
    total: null,
    intentos: 0
  };

  const oyentesCambio = [];
  const oyentesRecepcion = [];
  let temporizadorDebounce = null;
  let temporizadorReintento = null;

  // ------------------------------------------------------------------
  // Almacenamiento
  // ------------------------------------------------------------------
  function leerJson(clave, porDefecto) {
    try {
      const crudo = localStorage.getItem(clave);
      if (!crudo) return porDefecto;
      const valor = JSON.parse(crudo);
      return valor === null || valor === undefined ? porDefecto : valor;
    } catch (e) {
      console.error(`[Sync] No se pudo leer ${clave}:`, e);
      return porDefecto;
    }
  }

  function escribirJson(clave, valor) {
    try {
      localStorage.setItem(clave, JSON.stringify(valor));
      return true;
    } catch (e) {
      // Perder la cola es perder trabajo ya hecho en campo. Se grita.
      console.error(`[Sync] No se pudo guardar ${clave}:`, e);
      estado.ultimoError = 'no hay espacio para guardar los pendientes';
      avisarCambio();
      return false;
    }
  }

  function cola() {
    const c = leerJson(COLA_KEY, []);
    return Array.isArray(c) ? c : [];
  }

  function guardarCola(lista) {
    escribirJson(COLA_KEY, lista);
    estado.pendientes = lista.length;
  }

  function apartados() {
    const a = leerJson(APARTADOS_KEY, []);
    return Array.isArray(a) ? a : [];
  }

  function cursor() {
    const c = leerJson(CURSOR_KEY, null);
    if (!c || typeof c !== 'object') return { seq: 0, ultimaSync: null, offsetMs: 0 };
    return {
      seq: Number(c.seq) || 0,
      ultimaSync: c.ultimaSync || null,
      offsetMs: Number(c.offsetMs) || 0
    };
  }

  function guardarCursor(parcial) {
    const nuevo = Object.assign(cursor(), parcial);
    escribirJson(CURSOR_KEY, nuevo);
    return nuevo;
  }

  /**
   * Identificador propio del teléfono, estable de por vida.
   *
   * Vive aquí y no en app.js porque es lo que firma cada evento: si dos
   * teléfonos grabaron la misma etiqueta, esto es lo único que lo delata.
   */
  function dispositivo() {
    let id = null;
    try {
      id = localStorage.getItem(DISPOSITIVO_KEY);
    } catch (e) {
      return 'd-sin-almacenamiento';
    }
    if (!id) {
      const aleatorio = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      id = `d-${aleatorio}`;
      try {
        localStorage.setItem(DISPOSITIVO_KEY, id);
      } catch (e) {
        console.error('[Sync] No se pudo fijar el id del dispositivo:', e);
      }
    }
    return id;
  }

  /** Alias corto para mostrar en pantalla. El id completo no cabe ni se lee. */
  function alias(id) {
    const limpio = String(id || dispositivo()).replace(/[^a-zA-Z0-9]/g, '');
    return `TEL-${limpio.slice(-4).toUpperCase()}`;
  }

  // ------------------------------------------------------------------
  // Reloj
  // ------------------------------------------------------------------

  /**
   * La hora, corregida por el desfase del servidor.
   *
   * El desempate del last-write-wins es por fecha. Un teléfono con el reloj dos
   * días adelantado ganaría TODOS los empates contra los demás, incluso cuando
   * grabó antes. Corregir aquí es más barato que arbitrar allá.
   */
  function ahora() {
    return new Date(Date.now() + cursor().offsetMs).toISOString();
  }

  function anotarHoraServidor(serverTime) {
    if (!serverTime) return;
    const t = Date.parse(serverTime);
    if (Number.isNaN(t)) return;
    const offset = t - Date.now();
    // El viaje de red va incluido; por debajo de dos segundos es ruido y
    // reescribir localStorage en cada petición no aporta nada.
    if (Math.abs(offset - cursor().offsetMs) > 2000) {
      guardarCursor({ offsetMs: offset });
      if (Math.abs(offset) > 60000) {
        console.warn(`[Sync] El reloj del teléfono va desviado ${Math.round(offset / 1000)} s.`);
      }
    }
  }

  // ------------------------------------------------------------------
  // Red
  // ------------------------------------------------------------------
  function url(ruta) {
    return String(CFG.apiBase || '').replace(/\/+$/, '') + ruta;
  }

  /**
   * Una petición con tope de tiempo.
   *
   * El timeout no es un adorno: un WiFi con portal cautivo acepta la conexión y
   * no contesta nunca. Sin abortar, la sincronización quedaría colgada y el
   * indicador mintiendo hasta que se cierre la app.
   */
  async function pedir(ruta, opciones) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), TIMEOUT_MS);

    // Las cabeceras se montan aparte y se asignan AL FINAL. Fusionarlas dentro
    // del mismo Object.assign que las opciones hacía que el content-type del
    // POST reemplazara el objeto entero y se llevara por delante la llave: el
    // GET funcionaba y el POST devolvía 401.
    const cabeceras = Object.assign({ 'x-app-key': CFG.appKey }, (opciones && opciones.headers) || {});
    const peticion = Object.assign({ cache: 'no-store' }, opciones);
    peticion.headers = cabeceras;
    peticion.signal = control.signal;

    let respuesta;
    try {
      respuesta = await fetch(url(ruta), peticion);
    } catch (e) {
      throw { red: true, mensaje: control.signal.aborted ? 'el servidor no contestó' : 'sin conexión' };
    } finally {
      clearTimeout(reloj);
    }

    let cuerpo = null;
    try {
      cuerpo = await respuesta.json();
    } catch (e) {
      cuerpo = null;
    }

    if (!respuesta.ok) {
      throw {
        http: respuesta.status,
        mensaje: (cuerpo && cuerpo.error) || `HTTP ${respuesta.status}`
      };
    }
    anotarHoraServidor(cuerpo && cuerpo.serverTime);
    return cuerpo || {};
  }

  // ------------------------------------------------------------------
  // Subida
  // ------------------------------------------------------------------
  async function empujar() {
    let subidos = 0;

    // Se recarga la cola en cada vuelta a propósito: mientras se sube puede
    // estar grabándose otra etiqueta, y esa no debe perderse al guardar.
    while (cola().length) {
      const pendientes = cola();
      const antes = pendientes.length;
      const lote = pendientes.slice(0, LOTE);

      let r;
      try {
        r = await pedir('/api/eventos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ eventos: lote })
        });
      } catch (e) {
        if (e.http === 400) {
          // El cuerpo siempre lo construimos nosotros y siempre va troceado a
          // LOTE, así que un 400 no es algo que un reintento vaya a arreglar.
          // Dejarlo en la cola bloquearía todo lo demás para siempre.
          apartar(lote, e.mensaje);
          quitarDeLaCola(lote.map((ev) => ev.id));
          continue;
        }
        throw e;
      }

      const fuera = new Set([].concat(r.aceptados || [], r.duplicados || []));
      const rechazados = r.rechazados || [];

      if (rechazados.length) {
        const porId = new Map(lote.map((ev) => [ev.id, ev]));
        apartar(
          rechazados.map((x) => Object.assign({}, porId.get(x.id) || { id: x.id })),
          rechazados.map((x) => x.motivo).join('; ')
        );
        rechazados.forEach((x) => fuera.add(x.id));
      }

      if (fuera.size === 0) {
        // Ni aceptó, ni duplicó, ni rechazó: algo no cuadra y repetir el mismo
        // lote sería un bucle cerrado.
        throw { mensaje: 'el servidor no confirmó ningún evento del lote' };
      }

      quitarDeLaCola([...fuera]);
      subidos += (r.aceptados || []).length;

      // Si la cola no encogió, escribirla falló (cuota agotada, típicamente) y
      // la siguiente vuelta leería exactamente lo mismo: un bucle cerrado que
      // dejaría la app colgada con la etiqueta ya pegada en el módulo.
      if (cola().length >= antes) {
        throw { mensaje: 'no se pudo vaciar la cola: revisa el espacio del teléfono' };
      }
    }

    return subidos;
  }

  function quitarDeLaCola(ids) {
    const fuera = new Set(ids);
    guardarCola(cola().filter((ev) => !fuera.has(ev.id)));
  }

  function apartar(eventos, motivo) {
    const lista = apartados();
    eventos.forEach((ev) => {
      lista.push({ evento: ev, motivo: String(motivo || '').slice(0, 300), cuando: new Date().toISOString() });
    });
    escribirJson(APARTADOS_KEY, lista.slice(-500));
    estado.apartados = Math.min(lista.length, 500);
    console.error(`[Sync] ${eventos.length} evento(s) apartados: ${motivo}`);
  }

  // ------------------------------------------------------------------
  // Bajada
  // ------------------------------------------------------------------
  async function bajar() {
    let recibidos = 0;
    let vueltas = 0;
    let hayMas = true;

    while (hayMas && vueltas < VUELTAS_MAXIMAS) {
      vueltas++;
      const desde = cursor().seq;
      const r = await pedir(`/api/eventos?desde=${desde}&limite=${LIMITE_BAJADA}`, { method: 'GET' });
      const eventos = Array.isArray(r.eventos) ? r.eventos : [];

      if (typeof r.total === 'number') estado.total = r.total;

      if (eventos.length) {
        // Primero se entregan, después se avanza el cursor. Si la app fallara
        // al fusionarlos, el cursor no habrá avanzado y volverán a bajar.
        entregar(eventos);
        recibidos += eventos.length;
        guardarCursor({ seq: Number(r.siguienteCursor) || desde });
      }

      hayMas = Boolean(r.hayMas) && eventos.length > 0;
    }

    return recibidos;
  }

  function entregar(eventos) {
    oyentesRecepcion.forEach((fn) => {
      try {
        fn(eventos);
      } catch (e) {
        console.error('[Sync] Falló el receptor de eventos:', e);
      }
    });
  }

  // ------------------------------------------------------------------
  // Ciclo
  // ------------------------------------------------------------------
  async function sincronizar(motivo) {
    if (!estado.configurado) return instantanea();
    if (estado.sincronizando) return instantanea();
    if (estado.llaveInvalida && motivo !== 'manual') return instantanea();

    estado.sincronizando = true;
    estado.pendientes = cola().length;
    avisarCambio();

    try {
      const subidos = await empujar();
      const recibidos = await bajar();

      estado.intentos = 0;
      estado.llaveInvalida = false;
      estado.ultimoError = '';
      estado.ultimaSync = new Date().toISOString();
      estado.pendientes = cola().length;
      guardarCursor({ ultimaSync: estado.ultimaSync });

      if (subidos || recibidos) {
        console.log(`[Sync] ${motivo}: ${subidos} subidos, ${recibidos} recibidos.`);
      }
    } catch (e) {
      estado.intentos++;
      estado.ultimoError = e.mensaje || String(e);
      if (e.http === 401) {
        // Reintentar con una llave mala solo gasta batería. El botón manual la
        // vuelve a intentar, por si el despliegue la corrigió.
        estado.llaveInvalida = true;
        estado.ultimoError = 'llave rechazada por el servidor';
      } else {
        programarReintento();
      }
      console.warn(`[Sync] ${motivo} falló: ${estado.ultimoError}`);
    } finally {
      estado.sincronizando = false;
      estado.pendientes = cola().length;
      estado.apartados = apartados().length;
      avisarCambio();
    }

    return instantanea();
  }

  function programarReintento() {
    clearTimeout(temporizadorReintento);
    const espera = ESPERAS[Math.min(estado.intentos - 1, ESPERAS.length - 1)];
    temporizadorReintento = setTimeout(() => sincronizar('reintento'), espera);
  }

  /**
   * Encola un evento y lo intenta subir enseguida.
   *
   * El retardo agrupa la ráfaga de una pasada en pocas peticiones sin que el
   * operador tenga que esperar a nada: la etiqueta ya está grabada y guardada
   * en el teléfono antes de que esto se ejecute.
   */
  function encolar(evento) {
    if (!estado.configurado) return;
    const lista = cola();
    if (lista.some((ev) => ev.id === evento.id)) return;
    if (lista.length >= COLA_MAXIMA) {
      // Una cola así de larga solo pasa si algo lleva semanas roto. Mejor
      // negarse y avisar que crecer hasta reventar la cuota y perderlo todo.
      estado.ultimoError = 'hay demasiados pendientes: exporta un respaldo';
      avisarCambio();
      return;
    }
    lista.push(evento);
    guardarCola(lista);
    avisarCambio();

    clearTimeout(temporizadorDebounce);
    temporizadorDebounce = setTimeout(() => sincronizar('grabado'), DEBOUNCE_MS);
  }

  /** Vuelve a bajar el registro entero desde cero. Ruta de reparación. */
  async function reconstruir() {
    guardarCursor({ seq: 0 });
    return sincronizar('reconstruccion');
  }

  function avisarCambio() {
    const copia = instantanea();
    oyentesCambio.forEach((fn) => {
      try {
        fn(copia);
      } catch (e) {
        console.error('[Sync] Falló un oyente de estado:', e);
      }
    });
  }

  function instantanea() {
    const c = cursor();
    return {
      configurado: estado.configurado,
      sincronizando: estado.sincronizando,
      llaveInvalida: estado.llaveInvalida,
      pendientes: estado.pendientes,
      apartados: estado.apartados,
      total: estado.total,
      cursor: c.seq,
      offsetMs: c.offsetMs,
      ultimaSync: estado.ultimaSync || c.ultimaSync,
      ultimoError: estado.ultimoError,
      enLinea: typeof navigator.onLine === 'boolean' ? navigator.onLine : true
    };
  }

  // ------------------------------------------------------------------
  // Disparadores
  // ------------------------------------------------------------------
  if (estado.configurado) {
    const c = cursor();
    estado.ultimaSync = c.ultimaSync;
    estado.pendientes = cola().length;
    estado.apartados = apartados().length;

    window.addEventListener('online', () => sincronizar('volvio la senal'));
    window.addEventListener('offline', avisarCambio);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) sincronizar('app en primer plano');
    });
    setInterval(() => {
      if (!document.hidden) sincronizar('periodico');
    }, INTERVALO_MS);
  } else {
    console.log('[Sync] Sin llave configurada: el avance se queda solo en este teléfono.');
  }

  window.NfcSync = {
    dispositivo,
    alias,
    ahora,
    encolar,
    sincronizar,
    reconstruir,
    estado: instantanea,
    apartados,
    pendientes: cola,
    alRecibir: (fn) => oyentesRecepcion.push(fn),
    alCambiar: (fn) => { oyentesCambio.push(fn); fn(instantanea()); }
  };
})();
