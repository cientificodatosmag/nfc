/**
 * NFC TAG MASTER - CORE APPLICATION LOGIC
 * Features: Web NFC API, Burst Mass Formatting, Password Protection Burst, Password Unlock Verification, Web Audio Synth, PC Simulator, PWA.
 */

document.addEventListener('DOMContentLoaded', () => {
  
  // ==========================================
  // STATE MANAGEMENT
  // ==========================================
  const state = {
    isNfcSupported: 'NDEFReader' in window,
    isScanning: false,
    currentMode: 'burst', // 'burst', 'protect', 'inspect'
    simulatorActive: false,
    soundEnabled: true,
    hapticEnabled: true,
    overwriteAll: true,
    
    // Stats
    sessionClearedCount: 0,
    sessionFailedCount: 0,
    
    // Web NFC instances
    ndefReader: null,
    controller: null, // AbortController
    
    // History array
    history: JSON.parse(localStorage.getItem('nfc_tag_master_history') || '[]')
  };

  // Helper function for SHA-256 password hashing
  async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(`NFC_SALT_2026::${password}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

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
    toggleSoundBtn: document.getElementById('toggle-sound-btn'),
    soundIconOn: document.getElementById('sound-icon-on'),
    soundIconOff: document.getElementById('sound-icon-off'),
    toggleSimBtn: document.getElementById('toggle-sim-btn'),
    simBtnText: document.getElementById('sim-btn-text'),
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
  function checkCompatibility() {
    if (state.isNfcSupported) {
      DOM.compatBanner.className = 'alert-banner info';
      DOM.compatStatusText.innerHTML = '<strong>Web NFC Activo:</strong> Tu navegador es compatible con lecturas/escrituras NFC.';
    } else {
      DOM.compatBanner.className = 'alert-banner warning';
      DOM.compatStatusText.innerHTML = '<strong>Atención:</strong> Web NFC requiere Chrome en Android y HTTPS. Se activó automáticamente el <strong>Simulador PC</strong> para probar todas las funciones.';
      enableSimulator(true);
    }
  }

  // ==========================================
  // SIMULATOR MODE LOGIC
  // ==========================================
  function enableSimulator(enable) {
    state.simulatorActive = enable;
    if (enable) {
      DOM.simTriggerBox.classList.remove('hidden');
      DOM.toggleSimBtn.classList.add('btn-accent');
      DOM.simBtnText.textContent = 'Simulador Activo';
      
      // Inject simulated button for Protected Tag if not present
      if (!document.getElementById('sim-tap-protected')) {
        const btnProt = document.createElement('button');
        btnProt.id = 'sim-tap-protected';
        btnProt.className = 'btn btn-sm btn-outline-warning';
        btnProt.textContent = 'Simular Tag Con Clave (1234)';
        btnProt.addEventListener('click', simulateProtectedTagTap);
        DOM.simTriggerBox.querySelector('.sim-buttons').appendChild(btnProt);
      }

      showToast('Simulador NFC activado para pruebas en PC.', 'info');
    } else {
      DOM.simTriggerBox.classList.add('hidden');
      DOM.toggleSimBtn.classList.remove('btn-accent');
      DOM.simBtnText.textContent = 'Simulador PC';
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
  // WEB NFC CORE CONTROLLER
  // ==========================================
  async function startNfcScanner(mode = 'burst') {
    initAudio();

    if (mode === 'protect' && !DOM.protectPassInput.value.trim()) {
      showToast('Ingresa una contraseña para la protección masiva.', 'error');
      DOM.protectPassInput.focus();
      return;
    }

    if (!state.isNfcSupported && !state.simulatorActive) {
      showToast('Tu navegador no admite Web NFC. Activa el Simulador PC.', 'error');
      return;
    }

    state.isScanning = true;
    updateScannerUI(true, mode);

    if (state.simulatorActive) {
      playSound('beep');
      showToast(`Ráfaga [${mode.toUpperCase()}] lista en modo simulador. Haz clic en los botones de prueba.`, 'info');
      return;
    }

    try {
      state.controller = new AbortController();
      state.ndefReader = new NDEFReader();

      await state.ndefReader.scan({ signal: state.controller.signal });
      
      state.ndefReader.addEventListener('reading', async (event) => {
        handleNfcReading(event, mode);
      });

      state.ndefReader.addEventListener('readingerror', (event) => {
        handleNfcError(event);
      });

      playSound('beep');
      showToast(`Ráfaga iniciada (${mode === 'burst' ? 'Borrado Masivo' : 'Protección Masiva'}). Aproxima etiquetas.`, 'success');

    } catch (err) {
      console.error('NFC Scan Error:', err);
      stopNfcScanner();
      showToast(`Error al iniciar NFC: ${err.message || err}`, 'error');
    }
  }

  function stopNfcScanner() {
    state.isScanning = false;
    if (state.controller) {
      try { state.controller.abort(); } catch (e) {}
      state.controller = null;
    }
    state.ndefReader = null;
    updateScannerUI(false, state.currentMode);
    showToast('Escáner NFC detenido.', 'info');
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
  // NFC EVENT HANDLERS
  // ==========================================
  async function handleNfcReading(event, mode) {
    const serialNumber = event.serialNumber || `UID-MOCK-${Math.floor(1000 + Math.random()*9000)}`;
    const message = event.message || { records: [] };

    triggerRadarPulse('success', mode);

    if (mode === 'burst') {
      await processBurstFormat(serialNumber, message);
    } else if (mode === 'protect') {
      await processBurstProtect(serialNumber);
    } else if (mode === 'inspect') {
      processInspect(serialNumber, message);
    }
  }

  function handleNfcError(event) {
    state.sessionFailedCount++;
    DOM.statFailedCount.textContent = state.sessionFailedCount;
    triggerRadarPulse('error', state.currentMode);
    playSound('error');
    triggerHaptic([200, 100, 200]);
    addHistoryLog('ERROR', 'N/A', 'ERROR_LECTURA', 'No se pudo leer la etiqueta.');
    showToast('Error de comunicación con el chip NFC.', 'error');
  }

  // Helper function to format and wipe NFC tag cleanly
  async function writeEmptyTag(reader) {
    try {
      await reader.write({
        records: [{ recordType: "empty" }]
      }, { overwrite: true });
    } catch (e) {
      // Fallback for devices/Chromium expecting text record
      await reader.write({
        records: [{ recordType: "text", data: "" }]
      }, { overwrite: true });
    }
  }

  // ==========================================
  // RÁFAGA 1: BORRADO MASIVO & DESBLOQUEO DE CLAVE
  // ==========================================
  async function processBurstFormat(serialNumber, message) {
    try {
      // 1. Detect if tag is protected with an NFC_LOCK record
      let lockRecordHash = null;
      if (message && message.records) {
        for (const rec of message.records) {
          if (rec.data) {
            try {
              const text = new TextDecoder().decode(rec.data);
              // Check for hidden MIME lock or legacy text lock
              if (rec.mediaType === 'application/vnd.nfc-lock' && text.startsWith('HASH:')) {
                lockRecordHash = text.replace('HASH:', '').trim();
                break;
              } else if (text.startsWith('NFC_LOCK_V1:')) {
                lockRecordHash = text.replace('NFC_LOCK_V1:', '').trim();
                break;
              }
            } catch (e) {}
          }
        }
      }

      // 2. If tag has a lock, verify entered password
      if (lockRecordHash) {
        const enteredPassword = DOM.burstPassInput.value.trim();
        if (!enteredPassword) {
          throw new Error('Etiqueta Protegida por Contraseña. Ingrese la clave de desbloqueo en la casilla.');
        }

        const enteredHash = await hashPassword(enteredPassword);
        if (enteredHash !== lockRecordHash) {
          throw new Error('Contraseña Incorrecta. Acceso Denegado a borrado.');
        }
      }

      // 3. Clear/Format Tag safely using Web NFC compliant empty record
      if (!state.simulatorActive && state.ndefReader) {
        await writeEmptyTag(state.ndefReader);
      }

      state.sessionClearedCount++;
      DOM.statClearedCount.textContent = state.sessionClearedCount;

      const timeStr = new Date().toLocaleTimeString();
      DOM.lastTagInfo.className = 'tag-info-active';
      DOM.lastTagInfo.innerHTML = `
        <strong>[${timeStr}] FORMATEADA OK ${lockRecordHash ? '(Desbloqueada con Clave)' : ''}</strong><br>
        Serie (UID): <span style="color:#38bdf8">${serialNumber}</span><br>
        Estado: <em>Registros NDEF borrados (0 bytes)</em>
      `;

      playSound('success');
      triggerHaptic([80, 50, 80]);
      
      addHistoryLog('BORRADO MASIVO', serialNumber, 'ÉXITO', lockRecordHash ? 'Desbloqueada con clave y borrada' : 'NDEF borrado y formateado');
      showToast(`Etiqueta ${serialNumber} borrada correctamente!`, 'success');

    } catch (err) {
      console.error('Format Write Error:', err);
      state.sessionFailedCount++;
      DOM.statFailedCount.textContent = state.sessionFailedCount;

      playSound('error');
      triggerHaptic([300]);
      addHistoryLog('BORRADO MASIVO', serialNumber, 'FALLO', err.message || 'Error de protección o comunicación');
      showToast(`Fallo en ${serialNumber}: ${err.message || 'Bloqueada o alejada'}`, 'error');
    }
  }

  // ==========================================
  // RÁFAGA 2: PROTECCIÓN MASIVA POR CONTRASEÑA
  // ==========================================
  async function processBurstProtect(serialNumber) {
    const password = DOM.protectPassInput.value.trim();
    const protectContentInput = document.getElementById('protect-content-input');
    const visibleContent = protectContentInput ? protectContentInput.value.trim() : 'Etiqueta Protegida';

    if (!password) {
      stopNfcScanner();
      showToast('Ingresa una contraseña para la ráfaga de protección.', 'error');
      return;
    }

    try {
      const passHash = await hashPassword(password);

      // Create two records:
      // Record 1: Clean, readable content (visible in NFC Tools)
      // Record 2: Security MIME lock signature for app-level password authorization
      const recordsToWrite = [
        {
          recordType: 'text',
          data: visibleContent || 'Etiqueta Protegida'
        },
        {
          recordType: 'mime',
          mediaType: 'application/vnd.nfc-lock',
          data: new TextEncoder().encode(`HASH:${passHash}`)
        }
      ];

      if (!state.simulatorActive && state.ndefReader) {
        await state.ndefReader.write({
          records: recordsToWrite
        }, { overwrite: true });
      }

      state.sessionClearedCount++;
      DOM.statClearedCount.textContent = state.sessionClearedCount;

      playSound('success');
      triggerHaptic([100, 50, 100]);

      addHistoryLog('PROTECCIÓN MASIVA', serialNumber, 'ÉXITO', `Protegida con clave y texto libre`);
      showToast(`Etiqueta ${serialNumber} grabada y protegida!`, 'success');

    } catch (err) {
      console.error('Protect Write Error:', err);
      state.sessionFailedCount++;
      DOM.statFailedCount.textContent = state.sessionFailedCount;

      playSound('error');
      triggerHaptic([300]);
      addHistoryLog('PROTECCIÓN MASIVA', serialNumber, 'FALLO', err.message || 'Error al grabar clave');
      showToast(`Error al proteger ${serialNumber}: ${err.message}`, 'error');
    }
  }

  // ==========================================
  // OPERACION: INSPECCIÓN (TAB 3)
  // ==========================================
  function processInspect(serialNumber, message) {
    DOM.inspectPlaceholder.classList.add('hidden');
    DOM.inspectResultBox.classList.remove('hidden');
    
    DOM.inspectUid.textContent = serialNumber || 'Desconocido';
    const records = message.records || [];
    DOM.inspectRecordsCount.textContent = `${records.length} registro(s)`;

    let rawDetails = `Serie (UID): ${serialNumber}\nFecha: ${new Date().toLocaleString()}\n\n`;
    
    if (records.length === 0) {
      rawDetails += '--> Etiqueta Vacía / Formateada (Sin registros NDEF) <--';
    } else {
      records.forEach((rec, idx) => {
        rawDetails += `[Registro #${idx + 1}]\n`;
        rawDetails += `  RecordType: ${rec.recordType}\n`;
        rawDetails += `  MediaType:  ${rec.mediaType || 'N/A'}\n`;
        rawDetails += `  ID:         ${rec.id || 'N/A'}\n`;
        
        if (rec.data) {
          try {
            const text = new TextDecoder(rec.encoding || 'utf-8').decode(rec.data);
            if (rec.mediaType === 'application/vnd.nfc-lock' || text.startsWith('NFC_LOCK_V1:')) {
              rawDetails += `  TIPO:       🔒 REGISTRO DE SEGURIDAD (CANDADO)\n`;
              rawDetails += `  ESTADO:     Protegida para borrado/reescritura en la app\n\n`;
            } else {
              rawDetails += `  Contenido:  "${text}"\n\n`;
            }
          } catch (e) {
            rawDetails += `  Contenido:  [${rec.data.byteLength} bytes de datos binarios]\n\n`;
          }
        }
      });
    }

    DOM.inspectPayloadRaw.textContent = rawDetails;
    playSound('beep');
    addHistoryLog('INSPECCIÓN', serialNumber, 'ÉXITO', `${records.length} registros inspeccionados`);
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
  // SIMULATED TAP FOR PROTECTED TAG (PC SIMULATOR)
  // ==========================================
  async function simulateProtectedTagTap() {
    if (!state.isScanning) {
      showToast('Inicia primero el escáner (o modo ráfaga) para simular.', 'error');
      return;
    }

    const mockUid = `SIM-PROT-${Math.floor(100000 + Math.random() * 900000).toString(16).toUpperCase()}`;
    const defaultPassHash = await hashPassword('1234'); // Simulated password is 1234
    
    const mockEvent = {
      serialNumber: mockUid,
      message: {
        records: [{
          recordType: 'text',
          data: new TextEncoder().encode(`NFC_LOCK_V1:${defaultPassHash}`)
        }]
      }
    };

    handleNfcReading(mockEvent, state.currentMode);
  }

  // ==========================================
  // EVENT LISTENERS BINDING
  // ==========================================
  
  // Header Actions
  DOM.toggleSoundBtn.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    DOM.soundIconOn.classList.toggle('hidden', !state.soundEnabled);
    DOM.soundIconOff.classList.toggle('hidden', state.soundEnabled);
    showToast(`Sonido ${state.soundEnabled ? 'activado' : 'silenciado'}.`, 'info');
  });

  DOM.toggleSimBtn.addEventListener('click', () => {
    enableSimulator(!state.simulatorActive);
  });

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

  // Simulator Triggers
  DOM.simTapBlank.addEventListener('click', () => {
    if (!state.isScanning) {
      showToast('Inicia primero el escáner para simular.', 'error');
      return;
    }
    const mockUid = `SIM-${Math.floor(100000 + Math.random() * 900000).toString(16).toUpperCase()}`;
    const mockEvent = {
      serialNumber: mockUid,
      message: { records: [{ recordType: 'text', data: new TextEncoder().encode('Payload Sin Clave') }] }
    };
    handleNfcReading(mockEvent, state.currentMode);
  });

  DOM.simTapError.addEventListener('click', () => {
    if (!state.isScanning) {
      showToast('Inicia primero el escáner para simular.', 'error');
      return;
    }
    handleNfcError();
  });

  // Options Switches
  DOM.optSoundFeedback.addEventListener('change', (e) => state.soundEnabled = e.target.checked);
  DOM.optVibrateFeedback.addEventListener('change', (e) => state.hapticEnabled = e.target.checked);
  DOM.optOverwriteAll.addEventListener('change', (e) => state.overwriteAll = e.target.checked);

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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker Registered:', reg.scope))
      .catch(err => console.warn('Service Worker Error:', err));
  }

  // Startup Execution
  checkCompatibility();
  renderHistoryTable();
});
