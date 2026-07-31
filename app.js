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
  const BACKEND_MODE = { burst: 'format', protect: 'protect', inspect: 'read' };

  const state = {
    isScanning: false,
    currentMode: 'burst', // 'burst', 'protect', 'inspect'
    activeMode: null,     // pestaña que lanzó la ráfaga en curso
    simulatorActive: false,
    soundEnabled: true,
    hapticEnabled: true,
    overwriteAll: true,

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
    
    // History (Tab 4)
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
    state.isScanning = false;
    state.activeMode = null;
    window.NfcBackend.stop().catch(() => {});
    updateScannerUI(false, state.currentMode);
    showToast('Escáner NFC detenido.', 'info');
  }

  /** La contraseña y las opciones se envían al iniciar: si cambian, hay que reenviarlas. */
  async function refreshScanOptions() {
    if (!state.isScanning || state.simulatorActive || !state.activeMode) return;
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
    const radar = mode === 'protect' ? DOM.protectRadarCircle : DOM.radarCircle;
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
