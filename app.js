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
    rotStartBtn: document.getElementById('rot-start-btn'),
    rotStopBtn: document.getElementById('rot-stop-btn'),
    rotPrevBtn: document.getElementById('rot-prev-btn'),
    rotNextBtn: document.getElementById('rot-next-btn'),
    rotProgressTbody: document.getElementById('rot-progress-tbody'),
    rotExportCsv: document.getElementById('rot-export-csv'),
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

  function handleResult(result) {
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
      <strong>[${timeStr}] ${headline}</strong><br>
      Serie (UID): <span style="color:var(--brand-green)">${result.uid}</span><br>
      Chip: <span style="color:var(--brand-green)">${result.model}</span><br>
      Estado: <em>${detail}</em>
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
      <strong>[${timeStr}] FALLO</strong><br>
      Serie (UID): <span style="color:var(--brand-green)">${result.uid}</span><br>
      Motivo: <em>${message}</em>
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

    DOM.historyTbody.innerHTML = state.history.map(item => `
      <tr>
        <td>${item.timestamp}</td>
        <td><strong>${item.operation}</strong></td>
        <td><code>${item.serial}</code></td>
        <td>
          <span class="badge-status ${item.status === 'ÉXITO' ? 'success' : 'danger'}">
            ${item.status}
          </span>
        </td>
        <td>${item.details}</td>
      </tr>
    `).join('');
  }

  function exportHistoryCSV() {
    if (state.history.length === 0) {
      showToast('No hay datos en el historial para exportar.', 'error');
      return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,Fecha/Hora,Operacion,UID_Serie,Estado,Detalles\n';
    state.history.forEach(row => {
      csvContent += `"${row.timestamp}","${row.operation}","${row.serial}","${row.status}","${row.details}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `nfc_historial_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Historial CSV exportado con éxito.', 'success');
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
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
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
  // Cada módulo se rotula con tantas etiquetas como ramales tenga, más cuatro.
  const ETIQUETAS_EXTRA = 4;
  const ROT_PROGRESO_KEY = 'nfc_rotulado_progreso';

  const rot = {
    modulos: [],
    indice: 0,        // etiqueta en curso, base 0
    seleccion: null,
    activo: false,
    progreso: leerProgreso()
  };

  function leerProgreso() {
    try {
      return JSON.parse(localStorage.getItem(ROT_PROGRESO_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function guardarProgreso() {
    localStorage.setItem(ROT_PROGRESO_KEY, JSON.stringify(rot.progreso));
  }

  /** Comparación tolerante: el usuario puede escribir sin acentos ni mayúsculas. */
  function norm(texto) {
    return (texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }

  function totalEtiquetas(modulo) {
    return modulo.ramales + ETIQUETAS_EXTRA;
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

  function hechasDe(codigo) {
    const registro = registroDe(codigo);
    return registro ? Object.keys(registro.etiquetas).length : 0;
  }

  /** Primer número pendiente a partir de `desde`, o null si ya no queda ninguno. */
  function siguientePendiente(codigo, total, desde) {
    const registro = registroDe(codigo);
    const hechas = registro ? registro.etiquetas : {};
    for (let n = desde; n <= total; n++) {
      if (!hechas[n]) return n;
    }
    for (let n = 1; n < desde; n++) {
      if (!hechas[n]) return n;
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Carga del maestro
  // ------------------------------------------------------------------
  async function cargarModulos() {
    try {
      const respuesta = await fetch('modulos.json', { cache: 'no-store' });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const datos = await respuesta.json();
      rot.modulos = datos.modulos || [];
      console.log(`[Rotulado] ${rot.modulos.length} módulos cargados (maestro ${datos.generado}).`);
    } catch (err) {
      console.error('[Rotulado] No se pudo cargar modulos.json:', err);
      rot.modulos = [];
      DOM.rotModuloHint.textContent = 'No se pudo cargar el maestro de módulos (modulos.json).';
    }
    aplicarFiltros();
    renderProgresoTabla();
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

  const ESCAPES_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

  function escaparHtml(texto) {
    return String(texto).split('').map((c) => ESCAPES_HTML[c] || c).join('');
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
      const total = totalEtiquetas(m);
      const hechas = hechasDe(m.codigo);
      const estado = hechas === 0 ? `${total} etiquetas`
        : hechas >= total ? `completo (${total})`
        : `${hechas} de ${total}`;
      return { valor: m.codigo, detalle: `${m.finca} · ${estado}` };
    }));

    if (rot.modulos.length === 0) {
      DOM.rotModuloHint.textContent = 'No hay módulos cargados.';
    } else if (porFinca.length === 0) {
      DOM.rotModuloHint.textContent = 'Ningún módulo coincide con esos filtros.';
    } else {
      DOM.rotModuloHint.textContent = `${porFinca.length} módulo(s) disponibles de ${rot.modulos.length}.`;
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

    const total = totalEtiquetas(modulo);
    const siguiente = siguientePendiente(modulo.codigo, total, 1);
    rot.indice = (siguiente === null ? total : siguiente) - 1;

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

    const total = totalEtiquetas(modulo);
    const hechas = hechasDe(modulo.codigo);
    const completo = hechas >= total;

    DOM.rotCurrentLabel.textContent = completo ? '✓' : etiquetaActual();
    DOM.rotCurrentLabel.classList.toggle('rot-modulo-completo', completo);

    DOM.rotProgressText.textContent = `${hechas} de ${total}`;
    DOM.rotProgressDetail.textContent =
      `${modulo.ramales} ramales + ${ETIQUETAS_EXTRA} · ${modulo.finca}`;
    DOM.rotProgressFill.style.width = `${total ? (hechas / total) * 100 : 0}%`;

    DOM.rotScannerStatus.textContent = rot.activo
      ? `Acerca la etiqueta ${etiquetaActual()}`
      : completo ? 'Módulo completo' : 'Escáner inactivo';

    DOM.rotStartBtn.classList.toggle('hidden', rot.activo);
    DOM.rotStopBtn.classList.toggle('hidden', !rot.activo);
    DOM.rotRadarCircle.classList.toggle('scanning', rot.activo);

    const avisos = [];
    if (modulo.duplicado) {
      avisos.push(`El código ${modulo.codigo} aparece repetido en el maestro. Se graba un solo juego de etiquetas.`);
    }
    if (completo) {
      avisos.push('Todas las etiquetas de este módulo están grabadas.');
    }
    DOM.rotWarning.classList.toggle('hidden', avisos.length === 0);
    DOM.rotWarningText.textContent = avisos.join(' ');
  }

  function opcionesRotulado() {
    return {
      mode: 'rotular',
      password: DOM.rotPassInput.value.trim(),
      content: etiquetaActual(),
      fullWipe: state.overwriteAll,
      protectRead: false
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
    if (hechasDe(rot.seleccion.codigo) >= totalEtiquetas(rot.seleccion)) {
      showToast('Este módulo ya está completo. Reinicia su avance si quieres regrabarlo.', 'info');
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
      await window.NfcBackend.start(opcionesRotulado());
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
      await window.NfcBackend.start(opcionesRotulado());
    } catch (err) {
      console.warn('No se pudo actualizar la etiqueta en curso:', err);
    }
  }

  async function irAEtiqueta(numero) {
    if (!rot.seleccion) return;
    const total = totalEtiquetas(rot.seleccion);
    rot.indice = Math.max(0, Math.min(total - 1, numero - 1));
    actualizarUiRotulado();
    await reenviarEtiqueta();
  }

  async function avanzarTrasGrabar() {
    const total = totalEtiquetas(rot.seleccion);
    const siguiente = siguientePendiente(rot.seleccion.codigo, total, rot.indice + 2);

    if (siguiente === null) {
      actualizarUiRotulado();
      showToast(`Módulo ${rot.seleccion.codigo} completo: ${total} etiquetas.`, 'success');
      detenerRotulado();
      return;
    }

    rot.indice = siguiente - 1;
    actualizarUiRotulado();
    await reenviarEtiqueta();
  }

  // ------------------------------------------------------------------
  // Resultado de cada etiqueta
  // ------------------------------------------------------------------
  function registrarEtiqueta(codigo, numero, uid) {
    const modulo = rot.seleccion;
    if (!rot.progreso[codigo]) {
      rot.progreso[codigo] = {
        total: totalEtiquetas(modulo),
        region: modulo.region,
        responsable: modulo.responsable,
        finca: modulo.finca,
        etiquetas: {}
      };
    }
    rot.progreso[codigo].etiquetas[numero] = {
      texto: textoEtiqueta(codigo, numero),
      uid: uid || '',
      fecha: new Date().toISOString()
    };
    guardarProgreso();
    renderProgresoTabla();
    aplicarFiltros();
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

    registrarEtiqueta(rot.seleccion.codigo, rot.indice + 1, result.uid);

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
    const codigos = Object.keys(rot.progreso).sort();
    if (codigos.length === 0) {
      DOM.rotProgressTbody.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted">Todavía no se ha grabado ningún módulo.</td></tr>';
      return;
    }

    DOM.rotProgressTbody.innerHTML = codigos.map((codigo) => {
      const registro = rot.progreso[codigo];
      const numeros = Object.keys(registro.etiquetas).map(Number).sort((a, b) => a - b);
      const hechas = numeros.length;
      const ultima = numeros.length ? registro.etiquetas[numeros[numeros.length - 1]] : null;
      const completo = hechas >= registro.total;

      return `
        <tr>
          <td><code>${codigo}</code></td>
          <td>${registro.finca || ''}</td>
          <td>${registro.responsable || ''}</td>
          <td>
            <span class="badge-status ${completo ? 'success' : 'danger'}">
              ${hechas} / ${registro.total}
            </span>
          </td>
          <td>${ultima ? `<code>${ultima.texto}</code>` : ''}</td>
        </tr>
      `;
    }).join('');
  }

  function exportarRotuladoCSV() {
    const filas = [];
    Object.keys(rot.progreso).sort().forEach((codigo) => {
      const registro = rot.progreso[codigo];
      Object.keys(registro.etiquetas).map(Number).sort((a, b) => a - b).forEach((numero) => {
        const etiqueta = registro.etiquetas[numero];
        filas.push([
          codigo,
          registro.region || '',
          registro.responsable || '',
          registro.finca || '',
          numero,
          registro.total,
          etiqueta.texto,
          etiqueta.uid,
          etiqueta.fecha
        ]);
      });
    });

    if (filas.length === 0) {
      showToast('Todavía no hay etiquetas grabadas que exportar.', 'error');
      return;
    }

    const cabecera = ['Codigo_modulo', 'Region', 'Responsable', 'Finca', 'Numero_etiqueta',
      'Total_etiquetas', 'Texto_grabado', 'UID', 'Fecha_hora'];
    const csv = [cabecera, ...filas]
      .map((fila) => fila.map((celda) => `"${String(celda).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const enlace = document.createElement('a');
    enlace.href = encodeURI(`data:text/csv;charset=utf-8,${csv}`);
    enlace.download = `rotulado_modulos_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    showToast(`CSV exportado: ${filas.length} etiquetas.`, 'success');
  }

  function reiniciarAvance() {
    const codigo = rot.seleccion ? rot.seleccion.codigo : null;
    const soloEste = codigo && rot.progreso[codigo];
    const mensaje = soloEste
      ? `¿Borrar el avance de ${codigo}? Se perderá el registro de sus etiquetas grabadas.`
      : '¿Borrar el avance de TODOS los módulos?';

    if (!confirm(mensaje)) return;

    if (soloEste) {
      delete rot.progreso[codigo];
    } else {
      rot.progreso = {};
    }
    guardarProgreso();
    renderProgresoTabla();
    aplicarFiltros();
    if (rot.seleccion) {
      rot.indice = 0;
      actualizarUiRotulado();
    }
    showToast('Avance reiniciado.', 'info');
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
  DOM.rotStopBtn.addEventListener('click', detenerRotulado);
  DOM.rotPrevBtn.addEventListener('click', () => irAEtiqueta(rot.indice));
  DOM.rotNextBtn.addEventListener('click', () => irAEtiqueta(rot.indice + 2));

  DOM.rotExportCsv.addEventListener('click', exportarRotuladoCSV);
  DOM.rotResetProgress.addEventListener('click', reiniciarAvance);

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
  cargarModulos();

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
