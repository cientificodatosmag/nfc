/**
 * NFC TAG MASTER - CORE APPLICATION LOGIC
 * Features: Burst Mass Formatting, Password Protection Burst, Password Unlock Verification, Web Audio Synth, PC Simulator, PWA.
 *
 * El acceso al hardware vive en nfc-bridge.js (window.NfcBackend). Este archivo
 * solo pide operaciones y pinta resultados.
 */

document.addEventListener('DOMContentLoaded', () => {
  
  // ==========================================
  // STATE MANAGEMENT
  // ==========================================
  // Traducción de las pestañas de la UI a las operaciones del backend
  const BACKEND_MODE = { burst: 'format', protect: 'protect', inspect: 'read', rotular: 'rotular' };

  const state = {
    isScanning: false,
    currentMode: 'burst', // 'burst', 'protect', 'inspect'
    activeMode: null,     // pestaña que lanzó la ráfaga en curso
    simulatorActive: false,
    soundEnabled: true,
    hapticEnabled: true,
    overwriteAll: false, // borrado profundo: lento, solo bajo petición

    // Stats
    sessionClearedCount: 0,
    sessionFailedCount: 0,

    // History array
    history: JSON.parse(localStorage.getItem('nfc_tag_master_history') || '[]')
  };

  // ==========================================
  // DOM ELEMENTS
  // ==========================================
  const DOM = {
    // Tabs & Navigation
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    
    // Banners & Controls
    compatBanner: document.getElementById('compat-banner'),
    compatStatusText: document.getElementById('compat-status-text'),
    pwaInstallBtn: document.getElementById('pwa-install-btn'),
    apkDownloadBtn: document.getElementById('apk-download-btn'),
    statusPill: document.getElementById('status-pill'),
    statusDot: document.getElementById('status-dot'),
    statusLabel: document.getElementById('status-label'),
    simTriggerBox: document.getElementById('sim-trigger-box'),
    simTapBlank: document.getElementById('sim-tap-blank'),
    simTapProtected: null, // Dynamically created in sim box
    simTapError: document.getElementById('sim-tap-error'),
    
    // Burst Mode (Tab 1)
    radarCircle: document.getElementById('radar-circle'),
    scannerStatus: document.getElementById('scanner-status'),
    startBurstBtn: document.getElementById('start-burst-btn'),
    stopBurstBtn: document.getElementById('stop-burst-btn'),
    burstPassInput: document.getElementById('burst-pass-input'),
    toggleBurstPassVisibility: document.getElementById('toggle-burst-pass-visibility'),
    statClearedCount: document.getElementById('stat-cleared-count'),
    statFailedCount: document.getElementById('stat-failed-count'),
    lastTagInfo: document.getElementById('last-tag-info'),
    optSoundFeedback: document.getElementById('opt-sound-feedback'),
    optVibrateFeedback: document.getElementById('opt-vibrate-feedback'),
    optOverwriteAll: document.getElementById('opt-overwrite-all'),
    
    // Protect Mode (Tab 2)
    protectRadarCircle: document.getElementById('protect-radar-circle'),
    protectScannerStatus: document.getElementById('protect-scanner-status'),
    protectPassInput: document.getElementById('protect-pass-input'),
    protectContentInput: document.getElementById('protect-content-input'),
    protectContentGroup: document.getElementById('protect-content-group'),
    optLockOnly: document.getElementById('opt-lock-only'),
    togglePassVisibility: document.getElementById('toggle-pass-visibility'),
    startProtectBurstBtn: document.getElementById('start-protect-burst-btn'),
    stopProtectBurstBtn: document.getElementById('stop-protect-burst-btn'),
    
    // Inspect Mode (Tab 3)
    startInspectBtn: document.getElementById('start-inspect-btn'),
    inspectResultBox: document.getElementById('inspect-result-box'),
    inspectPlaceholder: document.getElementById('inspect-placeholder'),
    inspectUid: document.getElementById('inspect-uid'),
    inspectRecordsCount: document.getElementById('inspect-records-count'),
    inspectPayloadRaw: document.getElementById('inspect-payload-raw'),
    
    // Rotular Módulos (Tab 4)
    rotPassInput: document.getElementById('rot-pass-input'),
    toggleRotPassVisibility: document.getElementById('toggle-rot-pass-visibility'),
    rotRegion: document.getElementById('rot-region'),
    rotResponsable: document.getElementById('rot-responsable'),
    rotFinca: document.getElementById('rot-finca'),
    rotModulo: document.getElementById('rot-modulo'),
    rotRegionList: document.getElementById('rot-region-list'),
    rotResponsableList: document.getElementById('rot-responsable-list'),
    rotFincaList: document.getElementById('rot-finca-list'),
    rotModuloList: document.getElementById('rot-modulo-list'),
    rotRegionToggle: document.getElementById('rot-region-toggle'),
    rotResponsableToggle: document.getElementById('rot-responsable-toggle'),
    rotFincaToggle: document.getElementById('rot-finca-toggle'),
    rotModuloToggle: document.getElementById('rot-modulo-toggle'),
    rotModuloHint: document.getElementById('rot-modulo-hint'),
    rotResetFilters: document.getElementById('rot-reset-filters'),
    rotEmptyState: document.getElementById('rot-empty-state'),
    rotActive: document.getElementById('rot-active'),
    rotRadarCircle: document.getElementById('rot-radar-circle'),
    rotScannerStatus: document.getElementById('rot-scanner-status'),
    rotCurrentLabel: document.getElementById('rot-current-label'),
    rotProgressText: document.getElementById('rot-progress-text'),
    rotProgressDetail: document.getElementById('rot-progress-detail'),
    rotProgressFill: document.getElementById('rot-progress-fill'),
    rotWarning: document.getElementById('rot-warning'),
    rotWarningText: document.getElementById('rot-warning-text'),
    rotPasadaPanel: document.getElementById('rot-pasada-panel'),
    rotPasadaTexto: document.getElementById('rot-pasada-texto'),
    rotPasadaBtn: document.getElementById('rot-pasada-btn'),
    rotStartBtn: document.getElementById('rot-start-btn'),
    rotStopBtn: document.getElementById('rot-stop-btn'),
    rotPrevBtn: document.getElementById('rot-prev-btn'),
    rotNextBtn: document.getElementById('rot-next-btn'),
    rotProgressTbody: document.getElementById('rot-progress-tbody'),
    syncPill: document.getElementById('sync-pill'),
    syncDot: document.getElementById('sync-dot'),
    syncLabel: document.getElementById('sync-label'),
    rotSyncBtn: document.getElementById('rot-sync-btn'),
    rotSyncHint: document.getElementById('rot-sync-hint'),
    rotExportCsv: document.getElementById('rot-export-csv'),
    rotBackupJson: document.getElementById('rot-backup-json'),
    rotResetProgress: document.getElementById('rot-reset-progress'),

    // History (Tab 5)
    historyTbody: document.getElementById('history-tbody'),
    exportCsvBtn: document.getElementById('export-csv-btn'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),
    
    // Toast Container
    toastContainer: document.getElementById('toast-container')
  };

  // ==========================================
  // WEB AUDIO SYNTHESIZER
  // ==========================================
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playSound(type) {
    if (!state.soundEnabled) return;
    initAudio();
    if (!audioCtx) return;

    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1318.51, now); // E6
        osc.frequency.setValueAtTime(1760.00, now + 0.08); // A6
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.25, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'error') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(207.65, now);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'beep') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  function triggerHaptic(pattern = [100]) {
    if (state.hapticEnabled && 'vibrate' in navigator) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  }

  // ==========================================
  // INITIALIZATION & COMPATIBILITY
  // ==========================================
  /**
   * Cuando todo va bien basta el punto verde. El banner solo aparece si hay
   * algo que el usuario tenga que resolver.
   */
  function setStatus(level, label, message) {
    DOM.statusDot.className = `status-dot ${level}`;
    DOM.statusPill.className = `status-pill ${level}`;
    DOM.statusLabel.textContent = label;

    if (!message) {
      DOM.compatBanner.classList.add('hidden');
      return;
    }
    DOM.compatStatusText.innerHTML = message;
    DOM.compatBanner.className = `alert-banner ${level === 'ok' ? 'info' : 'warning'}`;
  }

  function checkCompatibility() {
    const backend = window.NfcBackend;

    if (backend.kind !== 'native') {
      setStatus('error', 'Sin NFC', `${backend.reason} Se activó el simulador para probar la interfaz.`);
      enableSimulator(true);
      return;
    }

    const status = backend.status || {};

    if (!status.hasNfc) {
      setStatus('error', 'Sin NFC', 'Este dispositivo no tiene hardware NFC.');
      enableSimulator(true);
      return;
    }

    if (!status.enabled) {
      setStatus('warn', 'NFC apagado', 'El NFC del teléfono está apagado. Actívalo en los ajustes de Android.');
      return;
    }

    setStatus('ok', 'En línea', null);
  }

  // ==========================================
  // SIMULATOR MODE LOGIC
  // ==========================================
  /**
   * Ya no se activa a mano: solo entra solo cuando no hay lector NFC, para que
   * la interfaz siga siendo probable.
   */
  function enableSimulator(enable) {
    state.simulatorActive = enable;

    if (!enable) {
      DOM.simTriggerBox.classList.add('hidden');
      return;
    }

    DOM.simTriggerBox.classList.remove('hidden');

    if (!document.getElementById('sim-tap-protected')) {
      const btnProt = document.createElement('button');
      btnProt.id = 'sim-tap-protected';
      btnProt.className = 'btn btn-sm btn-outline-warning';
      btnProt.textContent = 'Simular Tag Con Clave (1234)';
      btnProt.addEventListener('click', () => simulateTap('protected'));
      DOM.simTriggerBox.querySelector('.sim-buttons').appendChild(btnProt);
    }
  }

  // ==========================================
  // TAB NAVIGATION
  // ==========================================
  DOM.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      state.currentMode = targetTab.replace('tab-', '');
      
      DOM.tabBtns.forEach(b => b.classList.remove('active'));
      DOM.tabPanes.forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(targetTab).classList.add('active');
      
      // Stop scanner if switching tabs
      if (state.isScanning) {
        stopNfcScanner();
      }
    });
  });

  // ==========================================
  // CONTROLADOR DEL ESCÁNER
  // ==========================================
  function currentScanOptions(mode) {
    const lockOnly = DOM.optLockOnly ? DOM.optLockOnly.checked : true;
    return {
      mode: BACKEND_MODE[mode],
      password: mode === 'protect'
        ? DOM.protectPassInput.value.trim()
        : DOM.burstPassInput.value.trim(),
      content: DOM.protectContentInput ? DOM.protectContentInput.value.trim() : '',
      fullWipe: state.overwriteAll,
      lockOnly
    };
  }

  async function startNfcScanner(mode = 'burst') {
    initAudio();

    if (mode === 'protect' && !DOM.protectPassInput.value.trim()) {
      showToast('Ingresa una contraseña para la protección masiva.', 'error');
      DOM.protectPassInput.focus();
      return;
    }

    if (window.NfcBackend.kind !== 'native' && !state.simulatorActive) {
      showToast(window.NfcBackend.reason || 'El NFC nativo no está disponible.', 'error');
      return;
    }

    state.isScanning = true;
    state.activeMode = mode;
    updateScannerUI(true, mode);

    if (state.simulatorActive) {
      playSound('beep');
      showToast(`Ráfaga [${mode.toUpperCase()}] lista en modo simulador. Haz clic en los botones de prueba.`, 'info');
      return;
    }

    try {
      await window.NfcBackend.start(currentScanOptions(mode));

      playSound('beep');
      const etiqueta = mode === 'burst' ? 'Borrado Masivo'
        : mode === 'protect' ? 'Protección Masiva' : 'Inspección';
      showToast(`Ráfaga iniciada (${etiqueta}). Aproxima etiquetas.`, 'success');

    } catch (err) {
      console.error('NFC Scan Error:', err);
      stopNfcScanner();
      showToast(`Error al iniciar NFC: ${err.message || err}`, 'error');
    }
  }

  function stopNfcScanner() {
    // El rotulado tiene su propia interfaz y su propio ciclo de etiquetas.
    if (state.activeMode === 'rotular') {
      detenerRotulado();
      return;
    }
    state.isScanning = false;
    state.activeMode = null;
    window.NfcBackend.stop().catch(() => {});
    updateScannerUI(false, state.currentMode);
    showToast('Escáner NFC detenido.', 'info');
  }

  /** La contraseña y las opciones se envían al iniciar: si cambian, hay que reenviarlas. */
  async function refreshScanOptions() {
    if (!state.isScanning || state.simulatorActive || !state.activeMode) return;
    if (state.activeMode === 'rotular') {
      await reenviarEtiqueta();
      return;
    }
    try {
      await window.NfcBackend.stop();
      await window.NfcBackend.start(currentScanOptions(state.activeMode));
    } catch (err) {
      console.warn('No se pudo actualizar la sesión NFC:', err);
    }
  }

  function updateScannerUI(active, mode = 'burst') {
    const radar = mode === 'protect' ? DOM.protectRadarCircle : DOM.radarCircle;
    const statusText = mode === 'protect' ? DOM.protectScannerStatus : DOM.scannerStatus;

    if (active) {
      radar.classList.add('scanning');
      statusText.textContent = `Modo Ráfaga Activo: Aproxima etiquetas NFC continuamente...`;
      
      if (mode === 'burst') {
        DOM.startBurstBtn.classList.add('hidden');
        DOM.stopBurstBtn.classList.remove('hidden');
      } else if (mode === 'protect') {
        DOM.startProtectBurstBtn.classList.add('hidden');
        DOM.stopProtectBurstBtn.classList.remove('hidden');
      }
    } else {
      DOM.radarCircle.classList.remove('scanning', 'success-pulse', 'error-pulse');
      DOM.protectRadarCircle.classList.remove('scanning', 'success-pulse', 'error-pulse');
      
      DOM.scannerStatus.textContent = 'Escáner Inactivo';
      DOM.protectScannerStatus.textContent = 'Ingresa una contraseña para iniciar';

      DOM.startBurstBtn.classList.remove('hidden');
      DOM.stopBurstBtn.classList.add('hidden');
      DOM.startProtectBurstBtn.classList.remove('hidden');
      DOM.stopProtectBurstBtn.classList.add('hidden');
    }
  }

  // ==========================================
  // RESULTADOS DEL BACKEND NFC
  // ==========================================
  window.NfcBackend.onResult(handleResult);

  /**
   * Aviso de "esta etiqueta ya está hecha, retírala".
   *
   * El nativo lo repite mientras la etiqueta siga en el campo, así que se limita
   * a uno cada par de segundos para no llenar la pantalla de avisos.
   */
  let ultimoAvisoRepetida = 0;
  let temporizadorAvisoRepetida = null;
  function avisarEtiquetaRepetida(mode) {
    // El aviso va también al radar, que es donde mira quien está rotulando.
    if (mode === 'rotular' && DOM.rotScannerStatus) {
      DOM.rotScannerStatus.textContent = 'Retira la etiqueta ya grabada';
      clearTimeout(temporizadorAvisoRepetida);
      temporizadorAvisoRepetida = setTimeout(actualizarUiRotulado, 2000);
    }

    const ahora = Date.now();
    if (ahora - ultimoAvisoRepetida < 2000) return;
    ultimoAvisoRepetida = ahora;
    playSound('error');
    triggerHaptic([40, 60, 40]);
    showToast('Esa etiqueta ya está grabada. Retírala y acerca la siguiente.', 'info');
  }

  function handleResult(result) {
    if (result.repeat) {
      avisarEtiquetaRepetida(result.mode);
      return;
    }

    if (result.mode === 'rotular') {
      manejarResultadoRotulado(result);
      return;
    }

    triggerRadarPulse(result.success ? 'success' : 'error', state.activeMode || state.currentMode);

    if (result.mode === 'read' && result.success) {
      renderInspection(result);
      return;
    }

    if (result.success) {
      reportSuccess(result);
    } else {
      reportFailure(result);
    }
  }

  function operationLabel(mode) {
    if (mode === 'format') return 'BORRADO MASIVO';
    if (mode === 'protect') return 'PROTECCIÓN MASIVA';
    return 'INSPECCIÓN';
  }

  function reportSuccess(result) {
    state.sessionClearedCount++;
    DOM.statClearedCount.textContent = state.sessionClearedCount;

    let headline;
    let detail;
    if (result.mode === 'format') {
      headline = `FORMATEADA OK${result.unlocked ? ' (Desbloqueada con clave)' : ''}`;
      detail = result.unlocked
        ? 'Contraseña del chip retirada y memoria borrada'
        : `Memoria borrada (${result.wipedBytes || 0} bytes a cero)`;
    } else {
      headline = 'PROTEGIDA OK';
      const alcance = result.readProtected ? 'lectura y escritura' : 'escritura';
      const contenido = result.contentKept ? ', contenido intacto' : ', contenido reescrito';
      detail = state.simulatorActive
        ? 'Contraseña grabada en el chip (simulado)'
        : `Contraseña grabada en el chip (${alcance}${contenido})`;
    }

    const timeStr = new Date().toLocaleTimeString();
    DOM.lastTagInfo.className = 'tag-info-active';
    DOM.lastTagInfo.innerHTML = `
      <strong>[${escaparHtml(timeStr)}] ${escaparHtml(headline)}</strong><br>
      Serie (UID): <span style="color:var(--brand-green)">${escaparHtml(result.uid)}</span><br>
      Chip: <span style="color:var(--brand-green)">${escaparHtml(result.model)}</span><br>
      Estado: <em>${escaparHtml(detail)}</em>
    `;

    playSound('success');
    triggerHaptic([80, 50, 80]);
    addHistoryLog(operationLabel(result.mode), result.uid, 'ÉXITO', detail);
    showToast(`${result.uid}: ${headline}`, 'success');
  }

  function reportFailure(result) {
    state.sessionFailedCount++;
    DOM.statFailedCount.textContent = state.sessionFailedCount;

    const message = result.error || 'Error de comunicación con el chip NFC.';
    const timeStr = new Date().toLocaleTimeString();
    DOM.lastTagInfo.className = 'tag-info-active';
    DOM.lastTagInfo.innerHTML = `
      <strong>[${escaparHtml(timeStr)}] FALLO</strong><br>
      Serie (UID): <span style="color:var(--brand-green)">${escaparHtml(result.uid)}</span><br>
      Motivo: <em>${escaparHtml(message)}</em>
    `;

    playSound('error');
    triggerHaptic([300]);
    addHistoryLog(operationLabel(result.mode), result.uid, 'FALLO', message);
    showToast(`Fallo en ${result.uid}: ${message}`, 'error');
  }

  // ==========================================
  // OPERACION: INSPECCIÓN (TAB 3)
  // ==========================================
  function renderInspection(result) {
    DOM.inspectPlaceholder.classList.add('hidden');
    DOM.inspectResultBox.classList.remove('hidden');

    DOM.inspectUid.textContent = result.uid || 'Desconocido';
    const records = result.records || [];
    DOM.inspectRecordsCount.textContent = `${records.length} registro(s)`;

    let rawDetails = `Serie (UID): ${result.uid}\n`;
    rawDetails += `Chip:        ${result.model}\n`;
    if (result.capacity) {
      rawDetails += `Memoria:     ${result.capacity} bytes de usuario\n`;
    }
    rawDetails += `Contraseña:  ${result.protected ? 'SÍ — protegida por hardware' : 'No'}\n`;
    rawDetails += `Fecha:       ${new Date().toLocaleString()}\n\n`;

    if (records.length === 0) {
      rawDetails += '--> Etiqueta vacía / formateada (sin registros NDEF) <--';
    } else {
      records.forEach((rec, idx) => {
        const text = rec.text || '';
        rawDetails += `[Registro #${idx + 1}]\n`;
        rawDetails += `  Tipo:       ${rec.recordType}\n`;
        if (rec.mediaType) {
          rawDetails += `  MediaType:  ${rec.mediaType}\n`;
        }
        rawDetails += `  Tamaño:     ${rec.bytes || 0} bytes\n`;

        if (rec.mediaType === 'application/vnd.nfc-lock' || text.startsWith('NFC_LOCK_V1:')) {
          rawDetails += `  Contenido:  🔒 Candado por software (escrito por la versión PWA)\n\n`;
        } else {
          rawDetails += `  Contenido:  "${text}"\n\n`;
        }
      });
    }

    if (result.note) {
      rawDetails += `\nNota: ${result.note}\n`;
    }

    DOM.inspectPayloadRaw.textContent = rawDetails;
    playSound('beep');
    addHistoryLog('INSPECCIÓN', result.uid, 'ÉXITO', `${records.length} registros inspeccionados`);
  }

  // ==========================================
  // RADAR PULSE EFFECT
  // ==========================================
  function triggerRadarPulse(type, mode = 'burst') {
    const radar = mode === 'protect' ? DOM.protectRadarCircle
      : mode === 'rotular' ? DOM.rotRadarCircle
      : DOM.radarCircle;
    radar.classList.remove('success-pulse', 'error-pulse');
    void radar.offsetWidth;
    
    if (type === 'success') {
      radar.classList.add('success-pulse');
      setTimeout(() => radar.classList.remove('success-pulse'), 800);
    } else {
      radar.classList.add('error-pulse');
      setTimeout(() => radar.classList.remove('error-pulse'), 800);
    }
  }

  // ==========================================
  // HISTORIAL LOG SYSTEM
  // ==========================================
  function addHistoryLog(operation, serial, status, details) {
    const item = {
      timestamp: new Date().toLocaleString(),
      operation,
      serial: serial || 'N/A',
      status,
      details
    };
    state.history.unshift(item);
    if (state.history.length > 200) state.history.pop();
    
    localStorage.setItem('nfc_tag_master_history', JSON.stringify(state.history));
    renderHistoryTable();
  }

  function renderHistoryTable() {
    if (state.history.length === 0) {
      DOM.historyTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No hay registros guardados aún.</td></tr>`;
      return;
    }

    // item.details arrastra el mensaje de error que viene del plugin nativo, y
    // item.serial el UID de la etiqueta: nada de esto se pinta sin escapar.
    DOM.historyTbody.innerHTML = state.history.map(item => `
      <tr>
        <td>${escaparHtml(item.timestamp)}</td>
        <td><strong>${escaparHtml(item.operation)}</strong></td>
        <td><code>${escaparHtml(item.serial)}</code></td>
        <td>
          <span class="badge-status ${item.status === 'ÉXITO' ? 'success' : 'danger'}">
            ${escaparHtml(item.status)}
          </span>
        </td>
        <td>${escaparHtml(item.details)}</td>
      </tr>
    `).join('');
  }

  // ==========================================
  // EXPORTACIÓN DE ARCHIVOS
  // ==========================================
  /**
   * Une las filas en un CSV que Excel entienda.
   *
   * El BOM es obligatorio: sin él, Excel en Windows lee los acentos de fincas y
   * responsables como basura. Los saltos CRLF son los que espera Excel.
   */
  function construirCsv(cabecera, filas) {
    const escapar = (celda) => `"${String(celda === null || celda === undefined ? '' : celda).replace(/"/g, '""')}"`;
    return '﻿' + [cabecera, ...filas]
      .map((fila) => fila.map(escapar).join(','))
      .join('\r\n');
  }

  /**
   * Guarda un archivo y abre el selector de Android para enviarlo.
   *
   * El método anterior (<a href="data:...">) nunca funcionó dentro del APK: el
   * WebView solo descarga si la app registra un DownloadListener, y aun así
   * DownloadManager no sabe abrir URLs data:. Además encodeURI no escapa '#',
   * así que una almohadilla en un nombre truncaba el archivo entero.
   *
   * En el APK se escribe a caché y se comparte (WhatsApp, Gmail, Drive). En un
   * navegador de verdad el Blob sí descarga, así que ahí se usa eso.
   */
  async function compartirArchivo(nombre, contenido, mime) {
    // Aquí no hay empaquetador, así que los paquetes JS de Capacitor nunca se
    // cargan y Capacitor.Plugins puede venir vacío. registerPlugin() devuelve
    // el proxy que habla con la implementación nativa por su nombre, que es la
    // misma vía que usa nfc-bridge.js para el plugin de NFC.
    const cap = window.Capacitor;
    const nativo = cap && typeof cap.registerPlugin === 'function';

    if (nativo) {
      const Filesystem = cap.registerPlugin('Filesystem');
      const Share = cap.registerPlugin('Share');

      // btoa solo acepta latin1: se codifica a UTF-8 antes de pasar a base64.
      const bytes = new TextEncoder().encode(contenido);
      let binario = '';
      bytes.forEach((b) => { binario += String.fromCharCode(b); });

      await Filesystem.writeFile({ path: nombre, data: btoa(binario), directory: 'CACHE' });
      const { uri } = await Filesystem.getUri({ path: nombre, directory: 'CACHE' });
      await Share.share({ title: nombre, dialogTitle: `Enviar ${nombre}`, files: [uri] });
      return;
    }

    const url = URL.createObjectURL(new Blob([contenido], { type: mime }));
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Envuelve compartirArchivo para que el aviso de éxito solo salga si de verdad ocurrió. */
  async function exportar(nombre, contenido, mime, exito) {
    try {
      await compartirArchivo(nombre, contenido, mime);
      showToast(exito, 'success');
    } catch (err) {
      // Cancelar el selector de Android también llega aquí; no es un fallo.
      const motivo = String((err && err.message) || err);
      if (/cancel/i.test(motivo)) return;
      console.error('Exportación fallida:', err);
      showToast(`No se pudo exportar: ${motivo}`, 'error');
    }
  }

  function exportHistoryCSV() {
    if (state.history.length === 0) {
      showToast('No hay datos en el historial para exportar.', 'error');
      return;
    }

    const csv = construirCsv(
      ['Fecha/Hora', 'Operacion', 'UID_Serie', 'Estado', 'Detalles'],
      state.history.map((row) => [row.timestamp, row.operation, row.serial, row.status, row.details])
    );

    exportar(`nfc_historial_${new Date().toISOString().slice(0, 10)}.csv`, csv,
      'text/csv;charset=utf-8', `Historial exportado: ${state.history.length} registros.`);
  }

  function clearHistory() {
    if (confirm('¿Seguro que deseas borrar todo el historial local?')) {
      state.history = [];
      localStorage.removeItem('nfc_tag_master_history');
      renderHistoryTable();
      showToast('Historial borrado.', 'info');
    }
  }

  // ==========================================
  // TOAST NOTIFICATIONS
  // ==========================================
  /**
   * Se construye con nodos de texto, no con innerHTML.
   *
   * Llega aquí texto que no controlamos (errores del chip, códigos de módulo,
   * y en cuanto haya sincronización, cadenas de otros teléfonos). Escapar en el
   * sumidero una sola vez no se pudre; hacerlo en las ~20 llamadas, sí.
   */
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    const spanIcono = document.createElement('span');
    spanIcono.textContent = icon;
    const spanTexto = document.createElement('span');
    spanTexto.textContent = String(message);

    toast.append(spanIcono, ' ', spanTexto);
    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ==========================================
  // SIMULADOR DE ESCRITORIO
  // ==========================================
  const SIM_PASSWORD = '1234';

  function simulatedResult(overrides) {
    return Object.assign({
      success: true,
      mode: 'format',
      uid: `SIM-${Math.floor(100000 + Math.random() * 900000).toString(16).toUpperCase()}`,
      model: 'NTAG215 (simulada)',
      protected: false,
      unlocked: false,
      locked: false,
      readProtected: false,
      contentKept: DOM.optLockOnly ? DOM.optLockOnly.checked : true,
      empty: false,
      capacity: 504,
      wipedBytes: 504,
      records: [],
      note: '',
      error: ''
    }, overrides);
  }

  /** kind: 'blank' | 'protected' | 'error' */
  function simulateTap(kind) {
    if (!state.isScanning) {
      showToast('Inicia primero el escáner (o modo ráfaga) para simular.', 'error');
      return;
    }

    const mode = BACKEND_MODE[state.activeMode || state.currentMode] || 'read';

    if (kind === 'error') {
      handleResult(simulatedResult({
        mode,
        success: false,
        error: 'Etiqueta retirada demasiado pronto. Mantenla pegada al teléfono.'
      }));
      return;
    }

    const isProtected = kind === 'protected';

    // Una etiqueta protegida solo se deja borrar con la contraseña correcta.
    if (isProtected && mode === 'format') {
      const entered = DOM.burstPassInput.value.trim();
      if (entered !== SIM_PASSWORD) {
        handleResult(simulatedResult({
          mode,
          success: false,
          protected: true,
          error: entered
            ? 'Contraseña incorrecta: la etiqueta rechazó la autenticación.'
            : 'Etiqueta protegida por hardware: escribe su contraseña para poder borrarla.'
        }));
        return;
      }
    }

    handleResult(simulatedResult({
      mode,
      protected: isProtected,
      unlocked: isProtected && mode === 'format',
      locked: mode === 'protect',
      empty: mode === 'read' && !isProtected ? false : mode === 'format',
      records: mode === 'read'
        ? [{
            recordType: 'text',
            mediaType: '',
            text: isProtected ? 'Etiqueta Protegida' : 'Payload sin clave',
            bytes: 24
          }]
        : []
    }));
  }

  // ==========================================
  // ROTULADO POR MÓDULO
  // ==========================================
  // Mini y midi aspersión (MNA, MDA) se rotulan con tantas etiquetas como
  // ramales tenga el módulo, más cuatro, y el juego completo se graba DOS veces
  // sobre dos juegos de etiquetas distintos: solo está cumplido cuando las dos
  // pasadas terminaron.
  //
  // Los de aspersión (ASP) NO. Llevan SEIS etiquetas fijas —los ramales no
  // entran en la cuenta— y una sola pasada. Es otro procedimiento de campo, no
  // una variante del mismo.
  //
  // El avance frontal (AVF) y el pivote central (PVC) tampoco: son una máquina
  // sola, llevan DOS etiquetas fijas y una sola pasada.
  const ETIQUETAS_EXTRA = 4;
  const PASADAS = 2;

  // Tope del formato guardado: `progreso[codigo].pasadas` nunca tuvo más de dos
  // claves. Recorrer lo YA grabado va hasta aquí, no hasta las pasadas que la
  // regla pida hoy; si a un módulo le bajaran las pasadas de 2 a 1, sus
  // etiquetas de la pasada 2 siguen existiendo en el campo y hay que verlas.
  const MAX_PASADAS = 2;

  // La regla por tipo de riego. El tipo viaja en el código del módulo:
  // OOC-MNA-001 es mini aspersión, OOC-ASP-001 es aspersión.
  //
  // `fijas` en null significa "cuenta los ramales y súmales el extra". Con un
  // número, ese número es el total y los ramales no entran en la cuenta.
  //
  // Esta tabla es la misma que REGLAS en tools/reglas_rotulado.py, del lado del
  // teléfono. Cuando cambie una, cambia la otra: de ahí sale tanto lo que la
  // app manda a grabar como lo que la oficina manda a imprimir.
  const REGLA_POR_DEFECTO = { pasadas: PASADAS, extra: ETIQUETAS_EXTRA, fijas: null };
  const REGLA_POR_TIPO = {
    ASP: { pasadas: 1, extra: 0, fijas: 6 },
    AVF: { pasadas: 1, extra: 0, fijas: 2 },
    PVC: { pasadas: 1, extra: 0, fijas: 2 }
  };
  const CODIGO_MODULO = /^[A-Z]{3}-([A-Z]{3})-\d+$/;
  const ROT_PROGRESO_KEY = 'nfc_rotulado_progreso';   // formato v1, ya no se escribe
  const ROT_PROGRESO_V2_KEY = 'nfc_rotulado_progreso_v2';
  const ROT_MIGRACION_KEY = 'nfc_rotulado_migracion_v2';
  const ROT_SEMBRADO_KEY = 'nfc_sync_sembrado_v1';
  const DISPOSITIVO_KEY = 'nfc_dispositivo_id';

  const rot = {
    modulos: [],
    pasada: 1,        // pasada en curso, 1 o 2
    indice: 0,        // etiqueta en curso dentro de la pasada, base 0
    seleccion: null,
    activo: false,
    progreso: {},     // se llena en arrancarProgreso()
    maestro: null,    // {generado, origen, guardado} — de dónde salió la lista
    migracionFallida: ''
  };

  /**
   * Identificador propio del teléfono.
   *
   * Cuando sync.js está cargado él es el dueño —es quien firma cada evento que
   * sale a la red—, y aquí solo se le pregunta. La copia de abajo mantiene la
   * app funcionando si sync.js no está: misma clave y mismo formato, así que
   * cualquiera de los dos que se ejecute primero fija el valor y el otro lo lee.
   */
  function dispositivoId() {
    if (window.NfcSync) return window.NfcSync.dispositivo();
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
      guardarClave(DISPOSITIVO_KEY, id);
    }
    return id;
  }

  /** La hora corregida por el desfase del servidor, si hay con qué corregirla. */
  function fechaAhora() {
    return window.NfcSync ? window.NfcSync.ahora() : new Date().toISOString();
  }

  /**
   * Identificador del evento, derivado de su contenido.
   *
   * Ser determinista es lo que hace que reintentar una subida no duplique nada
   * y que volver a correr la migración no invente eventos nuevos. Incluye el
   * dispositivo porque dos teléfonos SÍ pueden grabar la misma etiqueta: si
   * compartieran id, el servidor guardaría solo uno y el conflicto —que es un
   * dato real, dos etiquetas físicas iguales— desaparecería sin dejar rastro.
   */
  function idEvento(codigo, pasada, numero, fecha, dispositivo) {
    const marca = Date.parse(fecha);
    const sufijo = String(dispositivo || dispositivoId()).replace(/[^a-zA-Z0-9]/g, '').slice(-10);
    return `${codigo}-${pasada}-${numero}-${sufijo}-${(Number.isNaN(marca) ? 0 : marca).toString(36)}`;
  }

  /** Un registro guardado -> el evento que viaja por la red. */
  function eventoDe(codigo, pasada, numero, entrada, registro) {
    const modulo = rot.modulos.find((m) => m.codigo === codigo) || null;
    return {
      id: entrada.id || idEvento(codigo, pasada, numero, entrada.fecha, entrada.dispositivo),
      tipo: 'grabada',
      modulo: codigo,
      pasada: Number(pasada),
      numero: Number(numero),
      texto: entrada.texto || textoEtiqueta(codigo, Number(numero)),
      uid: entrada.uid || '',
      fecha: entrada.fecha,
      dispositivoId: entrada.dispositivo || dispositivoId(),
      totalPasada: modulo ? totalPorPasada(modulo) : 0,
      region: (registro && registro.region) || '',
      responsable: (registro && registro.responsable) || '',
      finca: (registro && registro.finca) || ''
    };
  }

  function encolarEvento(evento) {
    if (window.NfcSync) window.NfcSync.encolar(evento);
  }

  /**
   * Escribe en localStorage avisando si la cuota se agotó.
   *
   * Un fallo silencioso aquí es pérdida de trabajo: el operador ya pegó la
   * etiqueta física y creería que quedó registrada.
   */
  function guardarClave(clave, valor) {
    try {
      localStorage.setItem(clave, valor);
      return true;
    } catch (e) {
      console.error('No se pudo guardar en localStorage:', e);
      showToast('¡No se pudo guardar el avance! Exporta un respaldo y libera espacio.', 'error');
      return false;
    }
  }

  function leerJson(clave) {
    try {
      return JSON.parse(localStorage.getItem(clave) || 'null');
    } catch (e) {
      return null;
    }
  }

  /**
   * Formato v2 del avance:
   *
   *   { "OOC-MNA-001": {
   *       region, responsable, finca,
   *       pasadas: { "1": { "7": {texto, uid, fecha, dispositivo} }, "2": {...} }
   *   }}
   *
   * El total NO se guarda a propósito: se calcula del maestro vivo. Guardarlo
   * hacía que un cambio de ramales dejara módulos "completos" que ya no lo son.
   */
  function arrancarProgreso() {
    const v2 = leerJson(ROT_PROGRESO_V2_KEY);
    if (v2 && typeof v2 === 'object') {
      rot.progreso = v2;
      return;
    }
    rot.progreso = migrarV1();
  }

  /**
   * Convierte el avance v1 en v2 tratándolo como pasada 1.
   *
   * Las etiquetas del formato viejo existen físicamente y dicen CODIGO-NNN, así
   * que son la primera pasada. La clave v1 NUNCA se borra: si esto sale mal,
   * de ahí se recupera todo.
   */
  function migrarV1() {
    // Se lee el texto crudo, no leerJson(): hay que poder distinguir "no hay
    // nada guardado" de "hay algo y no se puede leer". Confundirlos mostraría
    // "0 grabadas" ante un avance corrupto, y eso hace que se re-rotule un
    // módulo entero.
    let crudo = null;
    try {
      crudo = localStorage.getItem(ROT_PROGRESO_KEY);
    } catch (e) {
      crudo = null;
    }

    if (!crudo || crudo === '{}') {
      guardarClave(ROT_MIGRACION_KEY, 'sin-datos');
      return {};
    }

    let v1 = null;
    try {
      v1 = JSON.parse(crudo);
    } catch (e) {
      console.error('[Rotulado] El avance guardado no se puede leer:', e);
      rot.migracionFallida = 'el avance guardado está dañado';
      guardarClave(ROT_MIGRACION_KEY, `fallida: ${rot.migracionFallida}`);
      return {};
    }

    if (!v1 || typeof v1 !== 'object' || Object.keys(v1).length === 0) {
      guardarClave(ROT_MIGRACION_KEY, 'sin-datos');
      return {};
    }

    try {
      const migrado = {};
      let etiquetas = 0;
      Object.keys(v1).forEach((codigo) => {
        const viejo = v1[codigo] || {};
        const primera = {};
        Object.keys(viejo.etiquetas || {}).forEach((numero) => {
          const e = viejo.etiquetas[numero] || {};
          const fecha = e.fecha || new Date().toISOString();
          const dispositivo = dispositivoId();
          primera[numero] = {
            texto: e.texto || textoEtiqueta(codigo, Number(numero)),
            uid: e.uid || '',
            fecha,
            dispositivo,
            // Determinista: volver a migrar produce los mismos identificadores,
            // así que el servidor los reconoce como ya vistos en vez de crear
            // una segunda copia de todo el histórico.
            id: idEvento(codigo, 1, Number(numero), fecha, dispositivo)
          };
          etiquetas++;
        });
        migrado[codigo] = {
          region: viejo.region || '',
          responsable: viejo.responsable || '',
          finca: viejo.finca || '',
          pasadas: { 1: primera, 2: {} }
        };
      });

      guardarClave(ROT_PROGRESO_V2_KEY, JSON.stringify(migrado));
      guardarClave(ROT_MIGRACION_KEY, 'hecha');
      console.log(`[Rotulado] Avance migrado a v2: ${etiquetas} etiquetas como pasada 1.`);
      return migrado;
    } catch (err) {
      // Nunca presentar esto como "0 grabadas": un operador que ve un módulo
      // vacío lo vuelve a rotular entero y gasta un juego de etiquetas.
      console.error('[Rotulado] Falló la migración del avance:', err);
      rot.migracionFallida = String((err && err.message) || err);
      guardarClave(ROT_MIGRACION_KEY, `fallida: ${rot.migracionFallida}`);
      return {};
    }
  }

  function guardarProgreso() {
    guardarClave(ROT_PROGRESO_V2_KEY, JSON.stringify(rot.progreso));
  }

  /** Comparación tolerante: el usuario puede escribir sin acentos ni mayúsculas. */
  function norm(texto) {
    return (texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }

  // ------------------------------------------------------------------
  // Completitud: fuente única
  //
  // Antes cinco sitios distintos decidían por su cuenta si un módulo estaba
  // completo. Con dos pasadas eso era insostenible, así que todos pasan por
  // estas funciones y ninguno vuelve a recalcular la regla.
  // ------------------------------------------------------------------

  /**
   * Cuántas pasadas y cuántas etiquetas extra lleva este módulo.
   *
   * Manda el maestro cuando lo dice —así se corrige sin reinstalar la app, igual
   * que los ramales—, y si no lo dice se deduce del tipo de riego que lleva el
   * propio código. Esa deducción no es adorno: un maestro viejo, el del APK o
   * una copia guardada de antes de este cambio, no traen los campos, y un ASP
   * tratado con la regla de MNA mandaría a grabar el doble de etiquetas.
   */
  function reglaDe(modulo) {
    const tipo = CODIGO_MODULO.exec(String(modulo.codigo || '').toUpperCase());
    const base = (tipo && REGLA_POR_TIPO[tipo[1]]) || REGLA_POR_DEFECTO;
    const pasadas = Number.isInteger(modulo.pasadas)
      && modulo.pasadas >= 1 && modulo.pasadas <= MAX_PASADAS
      ? modulo.pasadas : base.pasadas;
    const extra = Number.isInteger(modulo.etiquetasExtra) && modulo.etiquetasExtra >= 0
      ? modulo.etiquetasExtra : base.extra;
    const fijas = Number.isInteger(modulo.etiquetasFijas) && modulo.etiquetasFijas >= 1
      ? modulo.etiquetasFijas : base.fijas;
    return { pasadas, extra, fijas };
  }

  /** Pasadas que exige este módulo: 2 en MNA/MDA, 1 en ASP, AVF y PVC. */
  function pasadasDe(modulo) {
    return reglaDe(modulo).pasadas;
  }

  /**
   * Etiquetas de UNA pasada. Sale del maestro vivo, nunca de lo guardado.
   *
   * Con etiquetas fijas los ramales ni se miran: un ASP lleva sus seis tenga
   * dos ramales u ocho, y un AVF o un PVC sus dos aunque vengan sin ramales.
   */
  function totalPorPasada(modulo) {
    const { extra, fijas } = reglaDe(modulo);
    return fijas === null || fijas === undefined ? modulo.ramales + extra : fijas;
  }

  function totalModulo(modulo) {
    return totalPorPasada(modulo) * pasadasDe(modulo);
  }

  function textoEtiqueta(codigo, numero) {
    return `${codigo}-${String(numero).padStart(3, '0')}`;
  }

  function etiquetaActual() {
    return rot.seleccion ? textoEtiqueta(rot.seleccion.codigo, rot.indice + 1) : '';
  }

  function registroDe(codigo) {
    return rot.progreso[codigo] || null;
  }

  /** Etiquetas ya grabadas en una pasada concreta. */
  function etiquetasDe(codigo, pasada) {
    const registro = registroDe(codigo);
    return (registro && registro.pasadas && registro.pasadas[pasada]) || {};
  }

  function hechasEnPasada(codigo, pasada) {
    return Object.keys(etiquetasDe(codigo, pasada)).length;
  }

  function hechasDe(codigo) {
    let total = 0;
    for (let p = 1; p <= MAX_PASADAS; p++) total += hechasEnPasada(codigo, p);
    return total;
  }

  function pasadaCompleta(modulo, pasada) {
    return hechasEnPasada(modulo.codigo, pasada) >= totalPorPasada(modulo);
  }

  function moduloCompleto(modulo) {
    for (let p = 1; p <= pasadasDe(modulo); p++) {
      if (!pasadaCompleta(modulo, p)) return false;
    }
    return true;
  }

  /** Primer número pendiente de una pasada a partir de `desde`, o null. */
  function siguientePendiente(codigo, pasada, total, desde) {
    const hechas = etiquetasDe(codigo, pasada);
    for (let n = desde; n <= total; n++) {
      if (!hechas[n]) return n;
    }
    for (let n = 1; n < desde; n++) {
      if (!hechas[n]) return n;
    }
    return null;
  }

  /** Dónde retomar: primero se termina la pasada 1, luego la 2 si la hay. */
  function siguienteObjetivo(modulo) {
    const total = totalPorPasada(modulo);
    for (let p = 1; p <= pasadasDe(modulo); p++) {
      const numero = siguientePendiente(modulo.codigo, p, total, 1);
      if (numero !== null) return { pasada: p, numero };
    }
    return null;
  }

  /**
   * Etiquetas del módulo que dos teléfonos grabaron por separado.
   *
   * No es un detalle de sincronización: significa que hay dos etiquetas físicas
   * pegadas en el campo diciendo lo mismo. Una de las dos sobra y hay que ir a
   * buscarla.
   */
  function duplicadosDe(codigo) {
    const fuera = [];
    for (let p = 1; p <= MAX_PASADAS; p++) {
      const etiquetas = etiquetasDe(codigo, p);
      Object.keys(etiquetas)
        .filter((n) => etiquetas[n].duplicado)
        .forEach((n) => fuera.push({ pasada: p, numero: Number(n) }));
    }
    return fuera.sort((a, b) => a.pasada - b.pasada || a.numero - b.numero);
  }

  /** ¿Este UID ya se usó en el módulo? Devuelve dónde, o null. */
  function uidYaUsado(codigo, uid) {
    if (!uid) return null;
    for (let p = 1; p <= MAX_PASADAS; p++) {
      const etiquetas = etiquetasDe(codigo, p);
      const encontrado = Object.keys(etiquetas).find((n) => etiquetas[n].uid === uid);
      if (encontrado) return { pasada: p, numero: Number(encontrado) };
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Carga del maestro
  //
  // Tres niveles, en este orden: servidor, copia guardada, copia del APK. Es lo
  // que permite corregir los ramales de un módulo sin reinstalar la app en cada
  // teléfono, y a la vez no depender de que haya señal para poder rotular.
  // ------------------------------------------------------------------
  const MAESTRO_CACHE_KEY = 'nfc_maestro_cache';
  const MAESTRO_TIMEOUT_MS = 8000;

  /**
   * ¿Esto sirve como maestro?
   *
   * Es la comprobación que impide el peor final: una respuesta truncada o una
   * página de error de un portal cautivo sustituyendo al maestro bueno y
   * dejando el desplegable vacío en pleno campo. Ante la duda se usa el nivel
   * siguiente, que en el peor caso es el que viene dentro del APK.
   */
  function maestroValido(datos) {
    if (!datos || typeof datos !== 'object') return false;
    if (!Array.isArray(datos.modulos) || datos.modulos.length === 0) return false;
    // `pasadas`, `etiquetasExtra` y `etiquetasFijas` son opcionales: un maestro
    // de antes de la aspersión no los trae y se deducen del código. Lo que no se
    // acepta es que vengan con un valor imposible, porque de ellos sale cuántas
    // etiquetas se graban.
    return datos.modulos.every((m) => m && typeof m.codigo === 'string' && m.codigo
      && Number.isInteger(m.ramales) && m.ramales >= 0
      && (m.pasadas === undefined
        || (Number.isInteger(m.pasadas) && m.pasadas >= 1 && m.pasadas <= MAX_PASADAS))
      && (m.etiquetasExtra === undefined
        || (Number.isInteger(m.etiquetasExtra) && m.etiquetasExtra >= 0))
      && (m.etiquetasFijas === undefined || m.etiquetasFijas === null
        || (Number.isInteger(m.etiquetasFijas) && m.etiquetasFijas >= 1)));
  }

  async function bajarMaestro() {
    const base = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || '';
    if (!base) return null;

    // Sin cabeceras condicionales a propósito. If-None-Match no está en la
    // lista blanca de CORS, así que obligaría a un preflight que el servidor de
    // archivos estáticos no contesta. El maestro pesa 18 KB: no compensa.
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), MAESTRO_TIMEOUT_MS);
    try {
      const respuesta = await fetch(`${base.replace(/\/+$/, '')}/modulos.json`,
        { cache: 'no-store', signal: control.signal });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const datos = await respuesta.json();
      if (!maestroValido(datos)) throw new Error('el maestro recibido no tiene forma de maestro');
      guardarClave(MAESTRO_CACHE_KEY, JSON.stringify({ guardado: new Date().toISOString(), datos }));
      return { datos, origen: 'servidor' };
    } catch (err) {
      // Un fallo aquí es lo normal en campo, no una avería: se sigue al
      // siguiente nivel sin ruido.
      console.log(`[Rotulado] Maestro por red no disponible (${err.message}).`);
      return null;
    } finally {
      clearTimeout(reloj);
    }
  }

  function maestroDeCache() {
    const guardado = leerJson(MAESTRO_CACHE_KEY);
    if (!guardado || !maestroValido(guardado.datos)) return null;
    return { datos: guardado.datos, origen: 'cache', guardado: guardado.guardado };
  }

  async function maestroDelApk() {
    try {
      const respuesta = await fetch('modulos.json', { cache: 'no-store' });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const datos = await respuesta.json();
      if (!maestroValido(datos)) throw new Error('el maestro empaquetado no es válido');
      return { datos, origen: 'app' };
    } catch (err) {
      console.error('[Rotulado] No se pudo cargar modulos.json:', err);
      return null;
    }
  }

  async function cargarModulos() {
    const antes = rot.modulos.map((m) => m.codigo);

    const fuente = (await bajarMaestro()) || maestroDeCache() || (await maestroDelApk());

    if (!fuente) {
      rot.modulos = [];
      rot.maestro = null;
      DOM.rotModuloHint.textContent = 'No se pudo cargar el maestro de módulos.';
      renderProgresoTabla();
      return;
    }

    rot.modulos = fuente.datos.modulos;
    rot.maestro = {
      generado: fuente.datos.generado || '',
      origen: fuente.origen,
      guardado: fuente.guardado || null
    };

    avisarModulosQueSalieron(antes);
    console.log(`[Rotulado] ${rot.modulos.length} módulos (maestro ${rot.maestro.generado}, `
      + `origen: ${fuente.origen}).`);

    aplicarFiltros();
    renderProgresoTabla();
  }

  /**
   * Avisa si un maestro nuevo se llevó por delante un módulo con avance.
   *
   * Que un módulo se retire es legítimo, y su avance no se borra: la tabla lo
   * sigue mostrando, solo que sin denominador. Lo que no puede es desaparecer
   * en silencio, porque alguien puede estar a mitad de rotularlo.
   */
  function avisarModulosQueSalieron(antes) {
    if (antes.length === 0) return;
    const ahora = new Set(rot.modulos.map((m) => m.codigo));
    const salieron = antes.filter((c) => !ahora.has(c) && hechasDe(c) > 0);
    if (salieron.length === 0) return;
    console.warn('[Rotulado] Salieron del maestro con avance grabado:', salieron);
    showToast(`El maestro nuevo ya no trae ${salieron.join(', ')}, y tienen etiquetas grabadas.`, 'error');
  }

  /** De dónde salió el maestro, en una frase que sirva a quien está en campo. */
  function procedenciaMaestro() {
    if (!rot.maestro) return '';
    const fecha = rot.maestro.generado ? `Maestro ${rot.maestro.generado}` : 'Maestro';
    if (rot.maestro.origen === 'servidor') return `${fecha} (del servidor).`;
    if (rot.maestro.origen === 'cache') return `${fecha} (guardado ${haceCuanto(rot.maestro.guardado)}).`;
    return `${fecha} (el de la app).`;
  }

  // ------------------------------------------------------------------
  // Filtros en cascada
  // ------------------------------------------------------------------
  function contiene(valor, texto) {
    return !texto || norm(valor).includes(norm(texto));
  }

  function unicos(modulos, campo) {
    return [...new Set(modulos.map((m) => m[campo]))].sort((a, b) => a.localeCompare(b, 'es'));
  }

  /**
   * Escapa para interpolar en innerHTML.
   *
   * La tabla vive dentro de la función a propósito: se llama desde sitios
   * declarados más arriba en el archivo, y una const externa quedaría en zona
   * muerta si alguna vez se invocara antes de tiempo.
   *
   * Incluye la comilla simple: hoy solo sería prescindible porque todos los
   * atributos de la plantilla usan comillas dobles, y eso nadie lo va a mantener.
   */
  function escaparHtml(texto) {
    const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(texto).split('').map((c) => escapes[c] || c).join('');
  }

  /**
   * Desplegable propio, anclado al campo.
   *
   * El <datalist> nativo lo dibuja Android por su cuenta y en el WebView acaba
   * en cualquier parte de la pantalla.
   *
   * La selección va en 'click', no en 'pointerdown': con pointerdown el primer
   * contacto del gesto ya elegía una opción y era imposible deslizar la lista.
   * Y la lista no se cierra al perder el foco, sino al tocar fuera de ella, que
   * es lo que permite desplazarla sin que desaparezca.
   */
  function crearCombo(input, lista, toggle, alElegir) {
    const combo = { opciones: [], abierto: false, setOpciones: null, cerrar: null };
    const contenedor = input.closest('.combo');

    function pintar() {
      const texto = norm(input.value);
      const visibles = combo.opciones.filter(
        (o) => !texto || norm(`${o.valor} ${o.detalle || ''}`).includes(texto)
      );

      lista.innerHTML = visibles.length
        ? visibles.map((o) => `
            <li class="combo-item" data-valor="${escaparHtml(o.valor)}">
              <span class="combo-valor">${escaparHtml(o.valor)}</span>
              ${o.detalle ? `<span class="combo-detalle">${escaparHtml(o.detalle)}</span>` : ''}
            </li>`).join('')
        : '<li class="combo-vacio">Sin coincidencias</li>';
    }

    function abrir() {
      combo.abierto = true;
      pintar();
      lista.classList.remove('hidden');
    }

    function cerrar() {
      combo.abierto = false;
      lista.classList.add('hidden');
    }

    input.addEventListener('focus', abrir);
    input.addEventListener('input', () => {
      abrir();
      alElegir(input.value, false);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        cerrar();
        input.blur();
      }
    });

    // La flecha despliega sin enfocar el campo: así no salta el teclado cuando
    // solo se quiere elegir de la lista.
    toggle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (combo.abierto) {
        cerrar();
      } else {
        abrir();
      }
    });

    lista.addEventListener('click', (e) => {
      const item = e.target.closest('.combo-item');
      if (!item) return;
      input.value = item.dataset.valor;
      cerrar();
      alElegir(input.value, true);
    });

    // Cerrar al tocar fuera. Un 'blur' cerraría la lista en cuanto el dedo la
    // tocara para desplazarla.
    document.addEventListener('pointerdown', (e) => {
      if (combo.abierto && !contenedor.contains(e.target)) {
        cerrar();
      }
    });

    combo.setOpciones = (opciones) => {
      combo.opciones = opciones;
      if (combo.abierto) pintar();
    };
    combo.cerrar = cerrar;
    return combo;
  }

  const comboRegion = crearCombo(DOM.rotRegion, DOM.rotRegionList, DOM.rotRegionToggle,
    () => aplicarFiltros());
  const comboResponsable = crearCombo(DOM.rotResponsable, DOM.rotResponsableList, DOM.rotResponsableToggle,
    () => aplicarFiltros());
  const comboFinca = crearCombo(DOM.rotFinca, DOM.rotFincaList, DOM.rotFincaToggle,
    () => aplicarFiltros());
  const comboModulo = crearCombo(DOM.rotModulo, DOM.rotModuloList, DOM.rotModuloToggle,
    (valor, elegido) => {
      if (elegido) seleccionarModulo(valor);
    });

  function modulosVisibles() {
    const porRegion = rot.modulos.filter((m) => contiene(m.region, DOM.rotRegion.value));
    const porResponsable = porRegion.filter((m) => contiene(m.responsable, DOM.rotResponsable.value));
    const porFinca = porResponsable.filter((m) => contiene(m.finca, DOM.rotFinca.value));
    return { porRegion, porResponsable, porFinca };
  }

  function aplicarFiltros() {
    const { porRegion, porResponsable, porFinca } = modulosVisibles();

    comboRegion.setOpciones(unicos(rot.modulos, 'region').map((v) => ({ valor: v })));
    comboResponsable.setOpciones(unicos(porRegion, 'responsable').map((v) => ({ valor: v })));
    comboFinca.setOpciones(unicos(porResponsable, 'finca').map((v) => ({ valor: v })));

    comboModulo.setOpciones(porFinca.map((m) => {
      const porPasada = totalPorPasada(m);
      const p1 = hechasEnPasada(m.codigo, 1);
      const p2 = hechasEnPasada(m.codigo, 2);
      const unaSola = pasadasDe(m) === 1;
      const estado = moduloCompleto(m) ? `completo (${totalModulo(m)})`
        : (p1 + p2) === 0 ? (unaSola ? `${porPasada} etiquetas` : `${porPasada} x2 etiquetas`)
        : unaSola ? `${p1}/${porPasada}`
        : `P1 ${p1}/${porPasada} · P2 ${p2}/${porPasada}`;
      return { valor: m.codigo, detalle: `${m.finca} · ${estado}` };
    }));

    // La procedencia se dice siempre. Un maestro de hace tres semanas no se
    // distingue de uno recién bajado si nadie lo cuenta, y de esa diferencia
    // depende que los ramales de un módulo sean los buenos.
    if (rot.modulos.length === 0) {
      DOM.rotModuloHint.textContent = 'No hay módulos cargados.';
    } else if (porFinca.length === 0) {
      DOM.rotModuloHint.textContent = `Ningún módulo coincide con esos filtros. ${procedenciaMaestro()}`;
    } else {
      DOM.rotModuloHint.textContent =
        `${porFinca.length} módulo(s) disponibles de ${rot.modulos.length}. ${procedenciaMaestro()}`;
    }
  }

  function limpiarFiltros() {
    DOM.rotRegion.value = '';
    DOM.rotResponsable.value = '';
    DOM.rotFinca.value = '';
    DOM.rotModulo.value = '';
    seleccionarModulo('');
    aplicarFiltros();
  }

  /**
   * Al elegir un módulo se rellenan sus filtros hacia arriba: así queda claro a
   * qué finca y responsable pertenece aunque se haya escrito el código directo.
   */
  function seleccionarModulo(codigo) {
    const modulo = rot.modulos.find((m) => norm(m.codigo) === norm(codigo)) || null;

    if (rot.activo) {
      detenerRotulado();
    }

    rot.seleccion = modulo;

    if (!modulo) {
      DOM.rotEmptyState.classList.remove('hidden');
      DOM.rotActive.classList.add('hidden');
      return;
    }

    DOM.rotRegion.value = modulo.region;
    DOM.rotResponsable.value = modulo.responsable;
    DOM.rotFinca.value = modulo.finca;
    DOM.rotModulo.value = modulo.codigo;

    // Retomar donde se quedó: primero los huecos de la pasada 1, luego la 2.
    const objetivo = siguienteObjetivo(modulo);
    if (objetivo) {
      rot.pasada = objetivo.pasada;
      rot.indice = objetivo.numero - 1;
    } else {
      rot.pasada = pasadasDe(modulo);
      rot.indice = totalPorPasada(modulo) - 1;
    }

    DOM.rotEmptyState.classList.add('hidden');
    DOM.rotActive.classList.remove('hidden');
    actualizarUiRotulado();
    aplicarFiltros();
  }

  // ------------------------------------------------------------------
  // Interfaz del grabado
  // ------------------------------------------------------------------
  function actualizarUiRotulado() {
    const modulo = rot.seleccion;
    if (!modulo) return;

    const { pasadas, extra, fijas } = reglaDe(modulo);
    const unaSola = pasadas === 1;
    // De dónde sale el número, dicho como lo diría alguien en el campo: por
    // ramal en mini y midi aspersión, una cantidad cerrada en los demás.
    const cuenta = (fijas === null || fijas === undefined)
      ? `${modulo.ramales} ramales + ${extra}`
      : `${fijas} etiquetas fijas`;
    const porPasada = totalPorPasada(modulo);
    const enPasada = hechasEnPasada(modulo.codigo, rot.pasada);
    const hechas = hechasDe(modulo.codigo);
    const completo = moduloCompleto(modulo);
    const esperandoPasada2 = !unaSola && pasadaCompleta(modulo, 1)
      && !pasadaCompleta(modulo, 2) && rot.pasada === 1;

    DOM.rotCurrentLabel.textContent = completo ? '✓' : etiquetaActual();
    DOM.rotCurrentLabel.classList.toggle('rot-modulo-completo', completo);

    // La barra mide el módulo entero (las dos pasadas cuando lleva dos); el
    // texto desglosa la pasada en curso, que es lo que el operador tiene entre
    // manos. Con una sola pasada no se nombra: no hay otra con la que confundirla.
    DOM.rotProgressText.textContent = completo
      ? `Completo · ${hechas} de ${totalModulo(modulo)}`
      : unaSola ? `${enPasada} de ${porPasada}`
      : `Pasada ${rot.pasada} de ${pasadas} · ${enPasada} de ${porPasada}`;
    DOM.rotProgressDetail.textContent =
      `${cuenta}, ${unaSola ? 'un solo juego' : 'dos juegos'} · ${modulo.finca}`;
    DOM.rotProgressFill.style.width =
      `${totalModulo(modulo) ? (hechas / totalModulo(modulo)) * 100 : 0}%`;

    DOM.rotScannerStatus.textContent = rot.activo
      ? (unaSola ? `Acerca la etiqueta ${etiquetaActual()}`
        : `Acerca la etiqueta ${etiquetaActual()} (pasada ${rot.pasada})`)
      : completo ? (unaSola ? 'Módulo completo: sus etiquetas están grabadas'
        : 'Módulo completo: las dos pasadas están grabadas')
      : esperandoPasada2 ? 'Pasada 1 lista. Toma el segundo juego de etiquetas.'
      : 'Escáner inactivo';

    DOM.rotStartBtn.classList.toggle('hidden', rot.activo || esperandoPasada2);
    DOM.rotStopBtn.classList.toggle('hidden', !rot.activo);
    DOM.rotRadarCircle.classList.toggle('scanning', rot.activo);
    DOM.rotRadarCircle.classList.toggle('rot-pasada-2', rot.pasada === 2);

    // El cambio de juego de etiquetas se pide de forma explícita: ver el
    // comentario de avanzarTrasGrabar sobre por qué no puede ser automático.
    DOM.rotPasadaPanel.classList.toggle('hidden', !esperandoPasada2);
    if (esperandoPasada2) {
      DOM.rotPasadaTexto.textContent =
        `Pasada 1 completa: ${porPasada} etiquetas grabadas. Guarda ese juego, ` +
        'toma el segundo y pulsa el botón para grabar las mismas ' +
        `${porPasada} otra vez.`;
    }

    const avisos = [];
    if (rot.migracionFallida) {
      avisos.push('No se pudo leer el avance guardado con el formato anterior. ' +
        'NO borres la app ni vuelvas a rotular: exporta un respaldo y avisa.');
    }
    if (modulo.duplicado) {
      avisos.push(`El código ${modulo.codigo} aparece repetido en el maestro. Se graba un solo juego de etiquetas.`);
    }
    if (completo) {
      avisos.push(unaSola
        ? 'Este módulo ya está grabado.'
        : 'Las dos pasadas de este módulo están grabadas.');
    }
    DOM.rotWarning.classList.toggle('hidden', avisos.length === 0);
    DOM.rotWarningText.textContent = avisos.join(' ');
  }

  /**
   * @param {boolean} sesionNueva Olvida la última etiqueta grabada. Solo al
   *   pulsar Iniciar: entre etiqueta y etiqueta hay que conservar esa memoria,
   *   que es lo que impide grabar dos veces sobre la misma.
   */
  function opcionesRotulado(sesionNueva) {
    return {
      mode: 'rotular',
      password: DOM.rotPassInput.value.trim(),
      content: etiquetaActual(),
      fullWipe: state.overwriteAll,
      protectRead: false,
      resetTagMemory: sesionNueva === true
    };
  }

  async function iniciarRotulado() {
    if (!rot.seleccion) {
      showToast('Elige primero un módulo.', 'error');
      return;
    }
    if (!DOM.rotPassInput.value.trim()) {
      showToast('Escribe la contraseña que llevarán las etiquetas.', 'error');
      DOM.rotPassInput.focus();
      return;
    }
    if (moduloCompleto(rot.seleccion)) {
      showToast(pasadasDe(rot.seleccion) === 1
        ? 'Este módulo ya está completo. Reinicia su avance si quieres regrabarlo.'
        : 'Las dos pasadas de este módulo ya están completas. Reinicia su avance si quieres regrabarlo.',
      'info');
      return;
    }
    if (window.NfcBackend.kind !== 'native' && !state.simulatorActive) {
      showToast(window.NfcBackend.reason || 'El NFC nativo no está disponible.', 'error');
      return;
    }

    initAudio();
    rot.activo = true;
    state.isScanning = true;
    state.activeMode = 'rotular';
    actualizarUiRotulado();

    if (state.simulatorActive) {
      playSound('beep');
      showToast('Simulador activo: usa los botones de prueba.', 'info');
      return;
    }

    try {
      await window.NfcBackend.start(opcionesRotulado(true));
      playSound('beep');
      showToast(`Listo. Acerca la etiqueta ${etiquetaActual()}`, 'success');
    } catch (err) {
      console.error('Rotulado start error:', err);
      detenerRotulado();
      showToast(`Error al iniciar NFC: ${err.message || err}`, 'error');
    }
  }

  function detenerRotulado() {
    rot.activo = false;
    state.isScanning = false;
    state.activeMode = null;
    window.NfcBackend.stop().catch(() => {});
    DOM.rotRadarCircle.classList.remove('scanning', 'success-pulse', 'error-pulse');
    actualizarUiRotulado();
  }

  /** El texto a grabar viaja al backend al arrancar: cambiar de etiqueta obliga a reenviarlo. */
  async function reenviarEtiqueta() {
    if (!rot.activo || state.simulatorActive) return;
    try {
      await window.NfcBackend.stop();
      await window.NfcBackend.start(opcionesRotulado(false));
    } catch (err) {
      console.warn('No se pudo actualizar la etiqueta en curso:', err);
    }
  }

  async function irAEtiqueta(numero) {
    if (!rot.seleccion) return;
    const total = totalPorPasada(rot.seleccion);
    rot.indice = Math.max(0, Math.min(total - 1, numero - 1));
    actualizarUiRotulado();
    await reenviarEtiqueta();
  }

  /**
   * Arranca la pasada 2 tras el cambio de juego de etiquetas.
   *
   * Es sesión nueva por definición, así que va con resetTagMemory: el bloqueo
   * nativo de UID recién grabado debe olvidarse antes de empezar.
   */
  async function empezarPasada2() {
    if (!rot.seleccion) return;
    rot.pasada = 2;
    const siguiente = siguientePendiente(rot.seleccion.codigo, 2, totalPorPasada(rot.seleccion), 1);
    rot.indice = (siguiente === null ? 1 : siguiente) - 1;
    actualizarUiRotulado();
    await iniciarRotulado();
  }

  async function avanzarTrasGrabar() {
    const modulo = rot.seleccion;
    const total = totalPorPasada(modulo);
    const siguiente = siguientePendiente(modulo.codigo, rot.pasada, total, rot.indice + 2);

    if (siguiente !== null) {
      rot.indice = siguiente - 1;
      actualizarUiRotulado();
      await reenviarEtiqueta();
      return;
    }

    // Se acabó la pasada en curso.
    //
    // Aquí NO se continúa solo con la siguiente. El operador tiene en la mano
    // la etiqueta que acaba de grabar, todavía pegada al teléfono, y la pasada
    // 2 empieza por el 001: seguir de largo la regrabaría. El bloqueo nativo
    // dura 1,5 s y no alcanza a salvarlo. Detener y exigir un toque explícito
    // refleja el acto físico de cambiar de bulto de etiquetas.
    detenerRotulado();

    const pasadas = pasadasDe(modulo);
    if (rot.pasada < pasadas) {
      playSound('success');
      triggerHaptic([80, 60, 80, 60, 160]);
      showToast(`Pasada ${rot.pasada} completa: ${total} etiquetas. Cambia de juego.`, 'success');
      actualizarUiRotulado();
      return;
    }

    // Última pasada terminada, pero puede haber huecos en una anterior.
    const pendiente = siguienteObjetivo(modulo);
    if (pendiente) {
      rot.pasada = pendiente.pasada;
      rot.indice = pendiente.numero - 1;
      actualizarUiRotulado();
      showToast(pasadas === 1
        ? `Faltan etiquetas. Retoma en la ${pendiente.numero}.`
        : `Faltan etiquetas de la pasada ${pendiente.pasada}. Retoma en la ${pendiente.numero}.`,
      'info');
      return;
    }

    actualizarUiRotulado();
    showToast(pasadas === 1
      ? `Módulo ${modulo.codigo} completo: ${totalModulo(modulo)} etiquetas.`
      : `Módulo ${modulo.codigo} completo: ${totalModulo(modulo)} etiquetas en ${pasadas} pasadas.`,
    'success');
  }

  // ------------------------------------------------------------------
  // Resultado de cada etiqueta
  // ------------------------------------------------------------------
  function registrarEtiqueta(codigo, pasada, numero, uid) {
    const modulo = rot.seleccion;
    if (!rot.progreso[codigo]) {
      rot.progreso[codigo] = {
        region: modulo.region,
        responsable: modulo.responsable,
        finca: modulo.finca,
        pasadas: {}
      };
    }
    // El total ya no se guarda: se calcula del maestro vivo, para que un cambio
    // de ramales no deje módulos "completos" que ya no lo son.
    const registro = rot.progreso[codigo];
    if (!registro.pasadas) registro.pasadas = {};
    if (!registro.pasadas[pasada]) registro.pasadas[pasada] = {};

    const fecha = fechaAhora();
    const dispositivo = dispositivoId();
    const entrada = {
      texto: textoEtiqueta(codigo, numero),
      uid: uid || '',
      fecha,
      dispositivo,
      id: idEvento(codigo, pasada, numero, fecha, dispositivo)
    };
    registro.pasadas[pasada][numero] = entrada;

    // Guardar en el teléfono primero y encolar después, en ese orden: la
    // etiqueta física ya está grabada, así que lo que no puede fallar es que
    // quede registrada aquí. La red es lo prescindible.
    guardarProgreso();
    encolarEvento(eventoDe(codigo, pasada, numero, entrada, registro));
    renderProgresoTabla();
    aplicarFiltros();
  }

  // ------------------------------------------------------------------
  // Registro compartido
  // ------------------------------------------------------------------

  /**
   * Sube al registro compartido lo que ya estaba grabado antes de encender la
   * sincronización.
   *
   * Corre una sola vez. Los identificadores son deterministas y el servidor es
   * idempotente, así que repetirlo no rompería nada — pero encolar miles de
   * eventos en cada arranque sí sería un desperdicio. Se hace después de cargar
   * el maestro para que cada evento lleve su total de pasada correcto.
   */
  function sembrarPendientes() {
    if (!window.NfcSync || !window.NfcSync.estado().configurado) return;
    try {
      if (localStorage.getItem(ROT_SEMBRADO_KEY)) return;
    } catch (e) {
      return;
    }

    let sembrados = 0;
    recorrerAvance((codigo, registro, pasada, numero, entrada) => {
      if (!entrada.id) {
        entrada.id = idEvento(codigo, pasada, numero, entrada.fecha, entrada.dispositivo);
      }
      encolarEvento(eventoDe(codigo, pasada, numero, entrada, registro));
      sembrados++;
    });

    if (sembrados) {
      guardarProgreso();
      console.log(`[Rotulado] ${sembrados} etiquetas ya grabadas se encolaron para el registro compartido.`);
    }
    guardarClave(ROT_SEMBRADO_KEY, new Date().toISOString());
  }

  /**
   * Mezcla lo que bajó del servidor con lo que hay en el teléfono.
   *
   * Aplica la MISMA regla que `proyectar()` en el servidor —barrera de reinicio,
   * después la fecha mayor y a igual fecha el id mayor—, y esa coincidencia es
   * lo único que hace que dos teléfonos que sincronizaron en distinto orden
   * acaben viendo lo mismo. Si alguna vez cambia una, tiene que cambiar la otra.
   */
  function fusionarEventos(eventos) {
    let cambios = 0;

    eventos.forEach((e) => {
      if (!e || !e.modulo) return;
      const registro = registroParaFusion(e);

      if (e.tipo === 'reset') {
        // Se recuerda la barrera, no solo se borra: si después baja un evento
        // anterior al reinicio (otro teléfono que subió tarde), tiene que
        // quedar descartado igual que lo está en el servidor.
        if (!registro.reset) registro.reset = {};
        const clave = e.pasada === 1 || e.pasada === 2 ? String(e.pasada) : 'global';
        if (!registro.reset[clave] || e.fecha > registro.reset[clave]) {
          registro.reset[clave] = e.fecha;
        }
        for (let p = 1; p <= MAX_PASADAS; p++) {
          if (clave !== 'global' && String(p) !== clave) continue;
          const etiquetas = (registro.pasadas && registro.pasadas[p]) || {};
          Object.keys(etiquetas).forEach((n) => {
            if (etiquetas[n].fecha <= e.fecha) {
              delete etiquetas[n];
              cambios++;
            }
          });
        }
        return;
      }

      if (e.pasada !== 1 && e.pasada !== 2) return;
      if (tapadoPorReinicio(registro, e)) return;

      if (!registro.pasadas) registro.pasadas = {};
      if (!registro.pasadas[e.pasada]) registro.pasadas[e.pasada] = {};
      const actual = registro.pasadas[e.pasada][e.numero];

      // Que dos teléfonos hayan escrito la misma clave significa que existen
      // DOS etiquetas físicas con el mismo texto. Se marca ANTES de decidir
      // quién gana, y da igual quién gane: si solo se mirara al ganador, el
      // caso en que llega la versión perdedora quedaría sin detectar y una de
      // las dos etiquetas seguiría circulando sin que nadie lo supiera.
      const duplicado = Boolean(actual) && actual.id !== e.id
        && actual.dispositivo !== e.dispositivo;
      if (duplicado && !actual.duplicado) {
        actual.duplicado = true;
        cambios++;
        console.warn(`[Sync] ${e.modulo} pasada ${e.pasada} nº ${e.numero}: `
          + `dos teléfonos la grabaron (${window.NfcSync.alias(actual.dispositivo)} y `
          + `${window.NfcSync.alias(e.dispositivo)}). Hay dos etiquetas físicas iguales.`);
      }

      if (actual && !(e.fecha > actual.fecha || (e.fecha === actual.fecha && e.id > actual.id))) {
        return;   // lo nuestro gana o es exactamente lo mismo
      }

      registro.pasadas[e.pasada][e.numero] = {
        texto: e.texto,
        uid: e.uid || '',
        fecha: e.fecha,
        dispositivo: e.dispositivo,
        id: e.id,
        // La marca sobrevive a que cambie el ganador: una vez que se sabe que
        // hay dos etiquetas iguales, eso ya no deja de ser cierto.
        duplicado: duplicado || Boolean(actual && actual.duplicado) || undefined
      };
      cambios++;
    });

    if (cambios) {
      guardarProgreso();
      renderProgresoTabla();
      aplicarFiltros();
      if (rot.seleccion) actualizarUiRotulado();
    }
  }

  /**
   * El registro donde encaja un evento que llega, creándolo si hace falta.
   *
   * Los rótulos visibles se toman del maestro local por código de módulo, no de
   * lo que manda el otro teléfono. Lo que llega por la red se muestra en
   * pantalla, y no hay razón para confiar en un texto ajeno cuando el bueno ya
   * está aquí.
   */
  function registroParaFusion(evento) {
    if (!rot.progreso[evento.modulo]) {
      const modulo = rot.modulos.find((m) => m.codigo === evento.modulo) || null;
      rot.progreso[evento.modulo] = {
        region: modulo ? modulo.region : (evento.region || ''),
        responsable: modulo ? modulo.responsable : (evento.responsable || ''),
        finca: modulo ? modulo.finca : (evento.finca || ''),
        pasadas: {}
      };
    }
    return rot.progreso[evento.modulo];
  }

  function tapadoPorReinicio(registro, evento) {
    if (!registro.reset) return false;
    const corte = [registro.reset.global, registro.reset[String(evento.pasada)]]
      .filter(Boolean).sort().pop();
    return Boolean(corte) && evento.fecha <= corte;
  }

  function manejarResultadoRotulado(result) {
    triggerRadarPulse(result.success ? 'success' : 'error', 'rotular');

    if (!rot.seleccion) return;
    const texto = etiquetaActual();

    if (!result.success) {
      state.sessionFailedCount++;
      DOM.statFailedCount.textContent = state.sessionFailedCount;
      playSound('error');
      triggerHaptic([300]);
      addHistoryLog('ROTULADO', result.uid, 'FALLO', `${texto}: ${result.error}`);
      showToast(`Fallo en ${texto}: ${result.error}`, 'error');
      return; // no avanza: se reintenta la misma etiqueta
    }

    // Cada pasada va sobre etiquetas físicas distintas. Si este UID ya está
    // registrado en el módulo, el operador tomó una del juego anterior: se
    // rechaza y no se avanza, porque grabarla destruiría la etiqueta ya hecha.
    const repetida = uidYaUsado(rot.seleccion.codigo, result.uid);
    if (repetida && !(repetida.pasada === rot.pasada && repetida.numero === rot.indice + 1)) {
      playSound('error');
      triggerHaptic([300]);
      addHistoryLog('ROTULADO', result.uid, 'FALLO',
        `Etiqueta ya usada en pasada ${repetida.pasada} nº ${repetida.numero}`);
      showToast(`Esa etiqueta ya se usó en la pasada ${repetida.pasada} (nº ${repetida.numero}). ` +
        'Toma una del juego nuevo.', 'error');
      return;
    }

    registrarEtiqueta(rot.seleccion.codigo, rot.pasada, rot.indice + 1, result.uid);

    state.sessionClearedCount++;
    DOM.statClearedCount.textContent = state.sessionClearedCount;
    playSound('success');
    triggerHaptic([80, 50, 80]);
    addHistoryLog('ROTULADO', result.uid, 'ÉXITO', `${texto} grabada y protegida`);
    showToast(`${texto} grabada`, 'success');

    avanzarTrasGrabar();
  }

  // ------------------------------------------------------------------
  // Avance guardado
  // ------------------------------------------------------------------
  function renderProgresoTabla() {
    // Un módulo sin etiquetas vivas no se lista. Pasa cuando baja un reinicio
    // del registro compartido: queda el registro con su barrera de fecha —que
    // hace falta, para que un evento anterior que suba tarde no lo resucite—
    // pero una fila "0 / 0" solo sería ruido en pantalla.
    const codigos = Object.keys(rot.progreso).filter((c) => hechasDe(c) > 0).sort();
    if (codigos.length === 0) {
      DOM.rotProgressTbody.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted">Todavía no se ha grabado ningún módulo.</td></tr>';
      return;
    }

    DOM.rotProgressTbody.innerHTML = codigos.map((codigo) => {
      const registro = rot.progreso[codigo];
      // El total sale del maestro; si el módulo ya no está en él (maestro viejo
      // o código retirado) se muestra el avance sin denominador en vez de
      // inventarse uno.
      const modulo = rot.modulos.find((m) => m.codigo === codigo) || null;
      const porPasada = modulo ? totalPorPasada(modulo) : null;
      const p1 = hechasEnPasada(codigo, 1);
      const p2 = hechasEnPasada(codigo, 2);
      const completo = modulo ? moduloCompleto(modulo) : false;

      // Un módulo de una sola pasada no lleva insignia "P1": no hay segunda de
      // la que distinguirla. La P2 aparece igual si hay etiquetas grabadas en
      // ella, aunque hoy el módulo pida una sola pasada: están en el campo.
      const unaSola = modulo ? pasadasDe(modulo) === 1 : false;
      const insignia = (pasada, hechas) => {
        const lleno = porPasada !== null && hechas >= porPasada;
        const rotulo = unaSola && pasada === 1 ? '' : `P${pasada} `;
        return `<span class="badge-status ${lleno ? 'success' : 'danger'}">`
          + `${rotulo}${hechas}${porPasada === null ? '' : ` / ${porPasada}`}</span>`;
      };
      const insignias = unaSola && p2 === 0
        ? insignia(1, p1)
        : `${insignia(1, p1)} ${insignia(2, p2)}`;

      const ultimaDe = (pasada) => {
        const etiquetas = etiquetasDe(codigo, pasada);
        const numeros = Object.keys(etiquetas).map(Number).sort((a, b) => a - b);
        return numeros.length ? etiquetas[numeros[numeros.length - 1]] : null;
      };
      const ultima = ultimaDe(2) || ultimaDe(1);

      // Los duplicados van en la misma fila y en rojo, no en una pantalla
      // aparte: son etiquetas físicas repetidas que alguien tiene que ir a
      // retirar, y en un listado secundario nadie las mira.
      const repetidas = duplicadosDe(codigo);
      const avisoDup = repetidas.length
        ? `<div class="rot-dup" title="Dos teléfonos grabaron estas etiquetas por separado">`
          + `⚠ ${repetidas.length} repetida(s): `
          + escaparHtml(repetidas.map((d) => `P${d.pasada}·${d.numero}`).join(', '))
          + '</div>'
        : '';

      return `
        <tr${completo ? ' class="rot-fila-completa"' : ''}>
          <td><code>${escaparHtml(codigo)}</code></td>
          <td>${escaparHtml(registro.finca || '')}</td>
          <td>${escaparHtml(registro.responsable || '')}</td>
          <td>${insignias}${avisoDup}</td>
          <td>${ultima ? `<code>${escaparHtml(ultima.texto)}</code>` : ''}</td>
        </tr>
      `;
    }).join('');
  }

  /** Recorre el avance etiqueta por etiqueta, en orden de módulo y pasada. */
  function recorrerAvance(fn) {
    Object.keys(rot.progreso).sort().forEach((codigo) => {
      const registro = rot.progreso[codigo];
      for (let pasada = 1; pasada <= MAX_PASADAS; pasada++) {
        const etiquetas = etiquetasDe(codigo, pasada);
        Object.keys(etiquetas).map(Number).sort((a, b) => a - b).forEach((numero) => {
          fn(codigo, registro, pasada, numero, etiquetas[numero]);
        });
      }
    });
  }

  function exportarRotuladoCSV() {
    const filas = [];
    recorrerAvance((codigo, registro, pasada, numero, etiqueta) => {
      const modulo = rot.modulos.find((m) => m.codigo === codigo) || null;
      filas.push([
        codigo,
        registro.region || '',
        registro.responsable || '',
        registro.finca || '',
        pasada,
        numero,
        modulo ? totalPorPasada(modulo) : '',
        etiqueta.texto,
        etiqueta.uid,
        etiqueta.fecha,
        etiqueta.dispositivo || '',
        etiqueta.duplicado ? 'SI' : ''
      ]);
    });

    if (filas.length === 0) {
      showToast('Todavía no hay etiquetas grabadas que exportar.', 'error');
      return;
    }

    const csv = construirCsv(
      ['Codigo_modulo', 'Region', 'Responsable', 'Finca', 'Pasada', 'Numero_etiqueta',
        'Total_por_pasada', 'Texto_grabado', 'UID', 'Fecha_hora', 'Dispositivo', 'Duplicado'],
      filas
    );

    const repetidas = filas.filter((f) => f[f.length - 1] === 'SI').length;
    const aviso = repetidas ? ` ${repetidas} repetida(s).` : '';
    exportar(`rotulado_modulos_${new Date().toISOString().slice(0, 10)}.csv`, csv,
      'text/csv;charset=utf-8', `CSV exportado: ${filas.length} etiquetas.${aviso}`);
  }

  /**
   * Respaldo crudo del avance, tal cual está en el teléfono.
   *
   * Es la red de seguridad antes de cualquier cambio de formato: si una
   * migración futura sale mal, de este archivo se recupera todo. Se exporta el
   * contenido literal de localStorage, sin reinterpretarlo.
   */
  function exportarRespaldoAvance() {
    // Van los DOS formatos: el v1 sigue intacto en el teléfono y es la única
    // copia de lo grabado antes de la migración.
    const v1 = localStorage.getItem(ROT_PROGRESO_KEY);
    const v2 = localStorage.getItem(ROT_PROGRESO_V2_KEY);

    if ((!v1 || v1 === '{}') && (!v2 || v2 === '{}')) {
      showToast('No hay avance guardado que respaldar.', 'error');
      return;
    }

    const respaldo = JSON.stringify({
      formato: 'nfc-rotulado-respaldo-v2',
      exportado: new Date().toISOString(),
      dispositivo: dispositivoId(),
      migracion: localStorage.getItem(ROT_MIGRACION_KEY) || '(sin registrar)',
      // Lo que aún no subió es justo lo que se perdería al desinstalar, así que
      // es lo primero que un respaldo tiene que llevar. Los apartados van
      // también: son los que el servidor rechazó y hay que mirar a mano.
      sincronizacion: window.NfcSync ? window.NfcSync.estado() : null,
      pendientes: window.NfcSync ? window.NfcSync.pendientes() : [],
      apartados: window.NfcSync ? window.NfcSync.apartados() : [],
      [ROT_PROGRESO_KEY]: v1 ? JSON.parse(v1) : null,
      [ROT_PROGRESO_V2_KEY]: v2 ? JSON.parse(v2) : null
    }, null, 2);

    let etiquetas = 0;
    recorrerAvance(() => { etiquetas++; });

    exportar(`respaldo_avance_${new Date().toISOString().slice(0, 10)}.json`, respaldo,
      'application/json', `Respaldo generado: ${etiquetas} etiquetas.`);
  }

  function reiniciarAvance() {
    const codigo = rot.seleccion ? rot.seleccion.codigo : null;
    const soloEste = codigo && rot.progreso[codigo];
    const mensaje = soloEste
      ? `¿Borrar el avance de ${codigo}? Se perderá el registro de sus ${hechasDe(codigo)} etiquetas.`
      : '¿Borrar el avance de TODOS los módulos?';

    // Se dice de frente: esto limpia la pantalla de este teléfono, no el
    // registro compartido. Creer lo contrario llevaría a rotular de nuevo algo
    // que para los demás sigue hecho. El borrado compartido es el Paso 5.
    const aviso = (window.NfcSync && window.NfcSync.estado().configurado)
      ? '\n\nSolo borra lo de ESTE teléfono. Los demás seguirán viendo estas etiquetas como grabadas.'
      : '';

    if (!confirm(mensaje + aviso)) return;

    if (soloEste) {
      delete rot.progreso[codigo];
    } else {
      rot.progreso = {};
    }
    guardarProgreso();
    renderProgresoTabla();
    aplicarFiltros();
    if (rot.seleccion) {
      rot.pasada = 1;
      rot.indice = 0;
      actualizarUiRotulado();
    }
    showToast('Avance reiniciado.', 'info');
  }

  // ------------------------------------------------------------------
  // Indicador de sincronización
  // ------------------------------------------------------------------
  function haceCuanto(iso) {
    if (!iso) return 'nunca';
    const minutos = Math.floor((Date.now() - Date.parse(iso)) / 60000);
    if (!Number.isFinite(minutos) || minutos < 0) return 'hace un momento';
    if (minutos < 1) return 'hace un momento';
    if (minutos < 60) return `hace ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `hace ${horas} h`;
    return `hace ${Math.floor(horas / 24)} d`;
  }

  /**
   * Pinta el estado de la red.
   *
   * Deliberadamente separado del punto verde del lector NFC. Son dos cosas que
   * fallan por motivos distintos y en momentos distintos, y un solo indicador
   * para ambas deja al operador sin saber cuál de las dos revisar.
   */
  function pintarSync(sync) {
    if (!DOM.syncPill) return;

    if (!sync.configurado) {
      DOM.syncPill.classList.add('hidden');
      if (DOM.rotSyncBtn) DOM.rotSyncBtn.classList.add('hidden');
      return;
    }

    DOM.syncPill.classList.remove('hidden');
    if (DOM.rotSyncBtn) DOM.rotSyncBtn.classList.remove('hidden');

    let nivel = 'ok';
    let texto = 'Al día';

    if (sync.llaveInvalida) {
      nivel = 'error';
      texto = 'Sin acceso';
    } else if (sync.sincronizando) {
      nivel = 'warn';
      texto = 'Sincronizando…';
    } else if (sync.pendientes > 0) {
      nivel = sync.ultimoError ? 'error' : 'warn';
      texto = `${sync.pendientes} sin subir`;
    } else if (sync.ultimoError) {
      nivel = 'warn';
      texto = 'Sin conexión';
    }

    DOM.syncDot.className = `status-dot ${nivel}`;
    DOM.syncPill.className = `status-pill sync-pill ${nivel}`;
    DOM.syncLabel.textContent = texto;
    DOM.syncPill.title = sync.ultimoError
      ? `Registro compartido: ${sync.ultimoError}. Toca para reintentar.`
      : `Registro compartido al día (${haceCuanto(sync.ultimaSync)}). Toca para sincronizar.`;

    if (!DOM.rotSyncHint) return;

    const partes = [`Compartido con los demás teléfonos, como ${window.NfcSync.alias()}.`];
    if (sync.pendientes > 0) {
      partes.push(`${sync.pendientes} sin subir.`);
    } else {
      partes.push(`Al día ${haceCuanto(sync.ultimaSync)}.`);
    }
    if (sync.apartados > 0) {
      partes.push(`${sync.apartados} rechazadas por el servidor.`);
    }

    // El aviso que importa: desinstalar la app con la cola llena pierde justo
    // eso. Un número pequeño no merece ruido; un montón acumulado, sí.
    const horasSinSubir = sync.ultimaSync
      ? (Date.now() - Date.parse(sync.ultimaSync)) / 3600000
      : Infinity;
    const urgente = sync.pendientes > 20 || (sync.pendientes > 0 && horasSinSubir > 24);
    if (urgente) partes.push('Busca señal antes de cerrar o desinstalar.');

    DOM.rotSyncHint.textContent = partes.join(' ');
    DOM.rotSyncHint.classList.toggle('text-danger', urgente);
  }

  // ==========================================
  // EVENT LISTENERS BINDING
  // ==========================================
  
  // El volumen lo gestiona el teléfono con sus botones físicos.

  // Scanner Buttons
  DOM.startBurstBtn.addEventListener('click', () => startNfcScanner('burst'));
  DOM.stopBurstBtn.addEventListener('click', () => stopNfcScanner());
  
  DOM.startProtectBurstBtn.addEventListener('click', () => startNfcScanner('protect'));
  DOM.stopProtectBurstBtn.addEventListener('click', () => stopNfcScanner());

  DOM.startInspectBtn.addEventListener('click', () => startNfcScanner('inspect'));

  // Toggle Password Visibility
  DOM.togglePassVisibility.addEventListener('click', () => {
    const input = DOM.protectPassInput;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  DOM.toggleBurstPassVisibility.addEventListener('click', () => {
    const input = DOM.burstPassInput;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Solo bloquear: el campo de contenido no pinta nada si no se va a escribir.
  function syncLockOnlyUI() {
    if (!DOM.optLockOnly || !DOM.protectContentGroup) return;
    DOM.protectContentGroup.classList.toggle('hidden', DOM.optLockOnly.checked);
  }

  if (DOM.optLockOnly) {
    DOM.optLockOnly.addEventListener('change', () => {
      syncLockOnlyUI();
      refreshScanOptions();
    });
    syncLockOnlyUI();
  }

  if (DOM.protectContentInput) {
    DOM.protectContentInput.addEventListener('change', refreshScanOptions);
  }

  // Rotulado por módulo
  DOM.toggleRotPassVisibility.addEventListener('click', () => {
    const input = DOM.rotPassInput;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Los combos ya escuchan sus propios eventos; esto cubre escribir el código
  // completo a mano y salir del campo sin tocar la lista.
  DOM.rotModulo.addEventListener('change', (e) => seleccionarModulo(e.target.value));
  DOM.rotResetFilters.addEventListener('click', limpiarFiltros);

  DOM.rotStartBtn.addEventListener('click', iniciarRotulado);
  DOM.rotPasadaBtn.addEventListener('click', empezarPasada2);
  DOM.rotStopBtn.addEventListener('click', detenerRotulado);
  DOM.rotPrevBtn.addEventListener('click', () => irAEtiqueta(rot.indice));
  DOM.rotNextBtn.addEventListener('click', () => irAEtiqueta(rot.indice + 2));

  DOM.rotExportCsv.addEventListener('click', exportarRotuladoCSV);
  DOM.rotBackupJson.addEventListener('click', exportarRespaldoAvance);
  DOM.rotResetProgress.addEventListener('click', reiniciarAvance);

  // Sincronizar a mano. Existe porque el automático no siempre puede: si el
  // operador acaba de caminar hasta donde hay señal, quiere verlo subir ahora y
  // no esperar al siguiente intento.
  function sincronizarAMano() {
    if (!window.NfcSync) return;
    const antes = window.NfcSync.estado();
    if (!antes.configurado) return;

    // Sincronizar a mano refresca también el maestro. Quien toca el botón
    // quiere "ponerme al día", no "sube mis etiquetas y deja la lista vieja".
    cargarModulos();

    window.NfcSync.sincronizar('manual').then((despues) => {
      if (despues.ultimoError) {
        showToast(`No se pudo sincronizar: ${despues.ultimoError}`, 'error');
      } else if (antes.pendientes) {
        showToast(`Sincronizado: ${antes.pendientes} etiquetas subidas.`, 'success');
      } else {
        showToast('Todo estaba al día.', 'info');
      }
    });
  }

  if (DOM.rotSyncBtn) DOM.rotSyncBtn.addEventListener('click', sincronizarAMano);
  if (DOM.syncPill) DOM.syncPill.addEventListener('click', sincronizarAMano);

  // Simulator Triggers
  DOM.simTapBlank.addEventListener('click', () => simulateTap('blank'));
  DOM.simTapError.addEventListener('click', () => simulateTap('error'));

  // La contraseña y las opciones viajan al backend al iniciar la ráfaga:
  // si cambian a mitad de sesión hay que reenviarlas.
  DOM.burstPassInput.addEventListener('change', refreshScanOptions);
  DOM.protectPassInput.addEventListener('change', refreshScanOptions);

  // Options Switches
  DOM.optSoundFeedback.addEventListener('change', (e) => state.soundEnabled = e.target.checked);
  DOM.optVibrateFeedback.addEventListener('change', (e) => state.hapticEnabled = e.target.checked);
  DOM.optOverwriteAll.addEventListener('change', (e) => {
    state.overwriteAll = e.target.checked;
    refreshScanOptions();
  });

  // El HTML manda: así el estado no puede quedar desalineado con la casilla.
  state.overwriteAll = DOM.optOverwriteAll.checked;
  state.soundEnabled = DOM.optSoundFeedback.checked;
  state.hapticEnabled = DOM.optVibrateFeedback.checked;

  // History Controls
  DOM.exportCsvBtn.addEventListener('click', exportHistoryCSV);
  DOM.clearHistoryBtn.addEventListener('click', clearHistory);

  // PWA Install Prompt
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    DOM.pwaInstallBtn.classList.remove('hidden');
  });

  DOM.pwaInstallBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        DOM.pwaInstallBtn.classList.add('hidden');
        showToast('¡PWA Instalada con éxito!', 'success');
      }
      deferredPrompt = null;
    }
  });

  // ==========================================
  // ARRANQUE
  // ==========================================
  renderHistoryTable();
  // El avance se lee (y migra si hace falta) antes de pintar nada, para que la
  // tabla nunca muestre "0 grabadas" mientras la migración está a medias.
  arrancarProgreso();
  if (rot.migracionFallida) {
    showToast('No se pudo leer el avance guardado. Exporta un respaldo antes de seguir.', 'error');
  }

  // El registro compartido se engancha antes de la primera sincronización, para
  // que ningún lote baje sin que haya quien lo fusione.
  if (window.NfcSync) {
    window.NfcSync.alRecibir(fusionarEventos);
    window.NfcSync.alCambiar(pintarSync);
  }

  // Sembrar necesita el maestro cargado (de ahí sale el total de cada pasada) y
  // la migración ya hecha, así que va encadenado y no en paralelo.
  cargarModulos().then(() => {
    sembrarPendientes();
    if (window.NfcSync) window.NfcSync.sincronizar('arranque');
  });

  // Detectar el puente nativo es asíncrono: hasta que responda no se sabe si
  // estamos en la APK, y de eso dependen el banner y el service worker.
  window.NfcBackend.ready.then((backend) => {
    checkCompatibility();

    // Dentro de la APK sobra el enlace para descargarla.
    if (backend.isApkOrigin && DOM.apkDownloadBtn) {
      DOM.apkDownloadBtn.classList.add('hidden');
    }

    // Nunca en la APK: el service worker sirve el index.html desde caché y se
    // salta la inyección del puente de Capacitor, dejando la app sin NFC. La
    // condición mira el origen, no el backend: si el puente falló, kind es
    // 'none' y registrarlo aquí perpetuaría la avería.
    if ('serviceWorker' in navigator && !backend.isApkOrigin) {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('Service Worker Registered:', reg.scope))
        .catch(err => console.warn('Service Worker Error:', err));
    }
  });
});
