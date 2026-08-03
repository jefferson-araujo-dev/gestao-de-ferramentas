import { metrics } from '../core/MetricsManager.js';
import { auth } from '../app.js';

async function requestToolMovement(body) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error('Sua sessão expirou. Entre novamente.');
  }

  if (!body?.toolId || (body.action === 'loan' && !body.collaboratorId)) {
    throw new Error('Dados da movimentação incompletos.');
  }

  const token = await currentUser.getIdToken();

  const response = await fetch('/api/tools/movement', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    cache: 'no-store'
  });

  let payload;

  try {
    payload = await response.json();
  } catch {
    throw new Error('A API retornou uma resposta inválida.');
  }

  if (!response.ok || payload?.success !== true) {
    throw new Error(
      payload?.message || 'Não foi possível registrar a movimentação.'
    );
  }

  return payload.data?.tool || null;
}
export const AppScanner = {
  currentTool: null,
  buffer: '',
  timeout: null,
  html5QrCode: null,
  currentMode: 'usb',
  isTorchOn: false,
  recentScans: [],
  scanStats: {
    today: 0,
    success: 0,
    errors: 0,
    totalTime: 0
  },

  init: function () {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    const scannerKeyHandler = (e) => {
      if (
        window.App.UI.activeTab !== 'scanner' ||
        this.currentMode !== 'usb' ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
      ) {
        return;
      }
      if (e.key === 'Enter') {
        if (this.buffer.length > 2) {
          this.processCode(this.buffer);
        }
        this.buffer = '';
      } else if (e.key.length === 1) {
        this.buffer += e.key;
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => {
          this.buffer = '';
        }, 60);
      }
    };
    document.addEventListener('keydown', scannerKeyHandler);

    // Foco Automático Contínuo para o modo USB
    document.addEventListener('focusout', () => {
      if (
        window.App &&
        window.App.UI &&
        window.App.UI.activeTab === 'scanner' &&
        this.currentMode === 'usb'
      ) {
        setTimeout(() => {
          const activeTag = document.activeElement?.tagName;
          if (!activeTag || !['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) {
            this.focus();
          }
        }, 50);
      }
    });

    document.getElementById('tab-scanner')?.addEventListener('click', (e) => {
      if (!['INPUT', 'BUTTON', 'SELECT'].includes(e.target.tagName)) {
        if (this.currentMode !== 'cam') {
          this.setMode('usb');
        }
        this.focus();
      }
    });
    const mFn = (e) => {
      if (e.key === 'Enter' && e.target.value.trim() !== '') {
        this.processCode(e.target.value.trim());
        e.target.value = '';
      }
    };
    document.getElementById('manual-scan-input')?.addEventListener('keydown', mFn);
    document.getElementById('hidden-scanner')?.addEventListener('keydown', mFn);

    this.loadStats();
  },

  loadStats: function () {
    const saved = localStorage.getItem('scanner-stats');
    if (saved) {
      const data = JSON.parse(saved);
      const today = new Date().toDateString();
      if (data.date === today) {
        this.scanStats = data.stats;
      } else {
        this.scanStats = { today: 0, success: 0, errors: 0, totalTime: 0 };
      }
    }
    this.updateStatsDisplay();
  },

  saveStats: function () {
    localStorage.setItem(
      'scanner-stats',
      JSON.stringify({
        date: new Date().toDateString(),
        stats: this.scanStats
      })
    );
  },

  updateStatsDisplay: function () {
    const statTodayEl = document.getElementById('stat-scans-today');
    if (statTodayEl) {
      statTodayEl.textContent = this.scanStats.today;
    }

    const total = this.scanStats.success + this.scanStats.errors;
    const rate = total > 0 ? Math.round((this.scanStats.success / total) * 100) : 100;
    const statRateEl = document.getElementById('stat-success-rate');
    if (statRateEl) {
      statRateEl.textContent = `${rate}%`;
    }

    const avg =
      this.scanStats.success > 0
        ? (this.scanStats.totalTime / this.scanStats.success).toFixed(1)
        : '--';
    const statAvgEl = document.getElementById('stat-avg-time');
    if (statAvgEl) {
      statAvgEl.textContent = avg !== '--' ? `${avg}s` : '--';
    }
  },

  addRecentScan: function (tool, success) {
    const scan = {
      code: tool.code,
      name: tool.name,
      status: tool.status,
      time: new Date(),
      success: success
    };
    this.recentScans.unshift(scan);
    if (this.recentScans.length > 10) {
      this.recentScans = this.recentScans.slice(0, 10);
    }
    this.renderRecentScans();
  },

  renderRecentScans: function () {
    const list = document.getElementById('recent-scans-list');
    if (!list) {
      return;
    }

    if (this.recentScans.length === 0) {
      list.innerHTML =
        '<div class="text-center py-4 text-slate-400 text-xs">Nenhuma leitura realizada ainda</div>';
      return;
    }

    list.innerHTML = this.recentScans
      .map((scan) => {
        const timeStr = scan.time.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        });

        let statusColor =
          scan.status === 'available' ? 'emerald' : scan.status === 'borrowed' ? 'amber' : 'rose';
        let statusText =
          scan.status === 'available'
            ? 'Disponível'
            : scan.status === 'borrowed'
              ? 'Emprestada'
              : 'Manutenção';
        if (!scan.success) {
          statusColor = 'rose';
          statusText = 'Não Encontrado';
        }

        return `<div class="recent-scan-item flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-bold text-slate-900 dark:text-white truncate">${window.Utils.escapeHTML(scan.name)}</p>
          <p class="text-xs text-slate-500 font-mono">${window.Utils.escapeHTML(scan.code)}</p>
        </div>
        <div class="text-right ml-3">
          <p class="text-xs text-slate-500">${timeStr}</p>
          <span class="inline-block mt-1 px-2 py-0.5 bg-${statusColor}-100 dark:bg-${statusColor}-900/30 text-${statusColor}-700 dark:text-${statusColor}-400 text-[10px] font-bold rounded">${statusText}</span>
        </div>
      </div>`;
      })
      .join('');
  },
  setMode: function (m) {
    this.currentMode = m;
    const a =
        'w-full sm:w-auto flex items-center justify-center px-3 sm:px-4 py-2.5 bg-brand-600 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-brand-600/20 hover:scale-105 active:scale-95 min-h-11',
      ia =
        'w-full sm:w-auto flex items-center justify-center px-3 sm:px-4 py-2.5 bg-slate-700 text-slate-300 font-bold rounded-xl text-sm hover:bg-slate-600 transition-all hover:scale-105 active:scale-95 min-h-11';
    const u = document.getElementById('btn-mode-usb'),
      c = document.getElementById('btn-mode-cam');
    if (u) {
      u.className = m === 'usb' ? a : ia;
    }
    if (c) {
      c.className = m === 'cam' ? a : ia;
    }
    const camContainer = document.getElementById('mode-cam-container');
    if (camContainer) {
      if (m === 'cam') {
        camContainer.classList.remove('hidden');
        camContainer.classList.add('flex');
      } else {
        camContainer.classList.add('hidden');
        camContainer.classList.remove('flex');
      }
    }

    const statusText = document.getElementById('scanner-status-text');
    const instructionText = document.getElementById('scanner-instruction-text');

    if (statusText) {
      statusText.textContent =
        m === 'usb' ? 'Aguardando leitura via USB' : 'Aguardando leitura via Câmera';
    }

    if (instructionText) {
      instructionText.textContent =
        m === 'usb'
          ? 'Conecte o leitor USB e aponte para o código QR.'
          : 'Posicione o código QR dentro da área de visualização.';
    }

    if (m === 'usb') {
      const h = document.getElementById('hidden-scanner');
      if (h) {
        setTimeout(() => h.focus(), 100);
      }
    }

    m === 'cam' ? this.startCamera() : this.stopCamera();
  },
  startCamera: async function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      window.App.UI.showToast(
        'Seu navegador não suporta acesso à câmera. Use o modo USB.',
        'error'
      );
      return this.setMode('usb');
    }
    if (!window.Html5Qrcode) {
      window.App.UI.showToast('Biblioteca de câmera não carregada. Use o modo USB.', 'error');
      return this.setMode('usb');
    }
    const readerEl = document.getElementById('reader');
    if (!readerEl) {
      window.App.UI.showToast('Erro interno: elemento de câmera não encontrado.', 'error');
      return this.setMode('usb');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (readerEl.offsetParent === null) {
      window.App.UI.showToast('Container da câmera não está visível.', 'error');
      return this.setMode('usb');
    }
    try {
      if (!this.html5QrCode) {
        this.html5QrCode = new window.Html5Qrcode('reader');
      }
      await this.stopCamera();
      const cfg = { fps: 10, qrbox: { width: 250, height: 250 } };
      const succ = (c) => {
        this.processCode(c);
        this.stopCamera();
      };
      await this.html5QrCode.start({ facingMode: 'environment' }, cfg, succ, () => {});
      window.Logger.info('Câmera traseira iniciada com sucesso.');
    } catch {
      try {
        await this.html5QrCode.start(
          { facingMode: 'user' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (c) => {
            this.processCode(c);
            this.stopCamera();
          },
          () => {}
        );
        window.Logger.info('Câmera frontal iniciada com sucesso.');
      } catch (e2) {
        const errorMsg = e2.message || String(e2);
        if (errorMsg.includes('Permission') || errorMsg.includes('NotAllowed')) {
          window.App.UI.showToast(
            'Permissão de câmera negada. Permita o acesso nas configurações do navegador.',
            'error'
          );
        } else if (errorMsg.includes('NotFound') || errorMsg.includes('NotFoundError')) {
          window.App.UI.showToast('Nenhuma câmera encontrada neste dispositivo.', 'error');
        } else {
          window.App.UI.showToast(
            'Não foi possível acessar a câmera. Verifique se há permissão.',
            'error'
          );
        }
        window.Logger.error('Erro ao iniciar câmera:', e2);
        this.setMode('usb');
      }
    }
  },
  stopCamera: async function () {
    if (!this.html5QrCode) {
      return;
    }
    try {
      if (this.html5QrCode.getState() === 2 || this.html5QrCode.isScanning) {
        await this.html5QrCode.stop();
        this.html5QrCode.clear();
      }
    } catch (e) {
      window.Logger.warn('Scanner já estava parado ou erro ao parar:', e?.message);
    } finally {
      this.isTorchOn = false;
      const torchIcon = document.getElementById('torch-icon');
      if (torchIcon) {
        torchIcon.classList.remove('text-yellow-400');
      }
    }
  },
  toggleTorch: async function () {
    if (!this.html5QrCode || this.html5QrCode.getState() !== 2) {
      return;
    } // 2 === SCANNING

    this.isTorchOn = !this.isTorchOn;
    try {
      await this.html5QrCode.applyVideoConstraints({
        advanced: [{ torch: this.isTorchOn }]
      });
      const torchIcon = document.getElementById('torch-icon');
      if (torchIcon) {
        if (this.isTorchOn) {
          torchIcon.classList.add('text-yellow-400');
        } else {
          torchIcon.classList.remove('text-yellow-400');
        }
      }
    } catch (err) {
      window.Logger.warn('Lanterna não suportada neste dispositivo', err);
      window.App.UI.showToast(
        'Lanterna não suportada ou permissão negada pelo sistema.',
        'warning'
      );
      this.isTorchOn = false;
      const torchIcon = document.getElementById('torch-icon');
      if (torchIcon) {
        torchIcon.classList.remove('text-yellow-400');
      }
    }
  },
  focus: function () {
    const h = document.getElementById('hidden-scanner');
    if (!this.currentTool && this.currentMode === 'usb' && h) {
      h.focus();
    }
  },
  processCode: function (c) {
    const startTime = Date.now();
    const searchCode = window.Utils.removeAccents(c).toLowerCase();
    const t = window.App.Data.tools.find(
      (x) =>
        x.code !== null &&
        x.code !== undefined &&
        window.Utils.removeAccents(x.code).toLowerCase() === searchCode
    );

    if (!t) {
      window.AudioSys.playBeep('error');
      // Feedback tátil de erro (vibração dupla) em dispositivos suportados
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }

      window.App.UI.showToast('Patrimônio não localizado.', 'error');

      this.scanStats.today++;
      this.scanStats.errors++;
      this.saveStats();
      this.updateStatsDisplay();

      this.addRecentScan(
        {
          code: c,
          name: 'Não encontrado',
          status: 'error'
        },
        false
      );

      const resultEl = document.getElementById('scanner-result');
      if (resultEl) {
        resultEl.classList.add('scan-error');
        setTimeout(() => resultEl.classList.remove('scan-error'), 500);
      }

      return this.reset();
    }

    window.AudioSys.playBeep('success');
    // Feedback tátil de sucesso (vibração única) em dispositivos suportados
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(100);
    }

    const elapsedTime = (Date.now() - startTime) / 1000;

    this.scanStats.today++;
    this.scanStats.success++;
    this.scanStats.totalTime += elapsedTime;
    this.saveStats();
    this.updateStatsDisplay();

    this.addRecentScan(t, true);

    this.currentTool = t;
    document.getElementById('scanner-waiting')?.classList.add('hidden');
    document.getElementById('scanner-result')?.classList.remove('hidden');

    const resultEl = document.getElementById('scanner-result');
    if (resultEl) {
      resultEl.classList.add('scan-success');
      setTimeout(() => resultEl.classList.remove('scan-success'), 600);
    }

    const sli = document.getElementById('scanner-line-indicator');
    if (sli) {
      sli.className =
        'absolute top-0 left-0 w-full h-2 transition-all duration-500 ' +
        (t.status === 'available' ? 'bg-emerald-500' : 'bg-rose-500');
    }
    const ric = document.getElementById('res-image-container');
    if (ric) {
      ric.innerHTML = t.imageUrl
        ? `<img src="${window.Utils.escapeHTML(t.imageUrl)}" class="w-16 h-16 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shadow-sm" loading="lazy" decoding="async">`
        : '<div class="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 text-slate-300 dark:text-slate-600"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>';
    }
    const sT = (id, txt) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = txt;
      }
    };
    const rcat = document.getElementById('res-category');
    if (rcat && rcat.querySelector('span')) {
      rcat.querySelector('span').textContent = t.category;
    }
    sT('res-name', t.name);
    sT('res-code', t.code);
    const rbdg = document.getElementById('res-badge-container');
    if (rbdg) {
      rbdg.innerHTML = window.Utils.getBadgeHTML(t.status);
    }

    const quickActions = document.getElementById('scanner-quick-actions');
    if (quickActions) {
      quickActions.classList.remove('hidden');
    }

    ['scanner-status-box', 'scanner-checkout', 'scanner-processing', 'scanner-return'].forEach(
      (id) => document.getElementById(id)?.classList.add('hidden')
    );
    if (t.status === 'borrowed') {
      const rui = document.getElementById('return-user-info');
      if (rui) {
        rui.innerHTML = `Com: <strong>${window.Utils.escapeHTML(t.currentUser || '-')}</strong>`;
      }
      document.getElementById('scanner-return')?.classList.remove('hidden');
      setTimeout(() => document.getElementById('btn-return')?.focus(), 100);
    } else if (t.status === 'available') {
      const bStat = document.getElementById('scanner-status-box');
      if (bStat) {
        bStat.innerHTML = '<div class="flex items-start text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 p-5 rounded-xl border border-emerald-200 dark:border-emerald-800 shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 mr-4 mt-0.5 text-emerald-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><div><p class="font-extrabold text-lg tracking-tight">Pronta para Uso</p><p class="text-sm font-medium mt-1">Autorize a retirada abaixo.</p></div></div>';
        bStat.classList.remove('hidden');
      }
      document.getElementById('scanner-checkout')?.classList.remove('hidden');
      const bi = document.getElementById('checkout-user-badge');

      if (t.nextMaintenance && new Date(t.nextMaintenance).getTime() < Date.now()) {
        window.AudioSys.playBeep('error');
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
        return window.App.UI.showToast(
          'Empréstimo bloqueado: Ferramenta com revisão/calibração vencida.',
          'error'
        );
      }

      if (bi) {
        bi.value = '';
        setTimeout(() => bi.focus(), 100);
      }
    } else {
      window.AudioSys.playBeep('error');
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
      window.App.UI.showToast('Em Manutenção ativa.', 'warning');
      setTimeout(() => this.reset(), 3000);
    }
  },
  processReturn: function () {
    if (!this.currentTool) {
      return;
    }
    document.getElementById('scanner-return')?.classList.add('hidden');
    document.getElementById('scanner-processing')?.classList.remove('hidden');
    setTimeout(async () => {
      try {
        await requestToolMovement({
          action: 'return',
          toolId: this.currentTool.firebaseId,
          device:
            window.App.Session.currentDevice ||
            window.navigator.userAgent ||
            'Navegador'
        });
        window.AudioSys.playBeep('success');
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(100);
        }
        window.App.UI.showToast('Devolução registrada.', 'success');
        document.getElementById('scanner-processing')?.classList.add('hidden');
        const rbc = document.getElementById('res-badge-container');
        if (rbc) {
          rbc.innerHTML = window.Utils.getBadgeHTML('available');
        }
        const ssb = document.getElementById('scanner-status-box');
        if (ssb) {
          ssb.innerHTML = '<div class="text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 p-6 rounded-2xl border border-emerald-200 dark:border-emerald-800 shadow-sm"><p class="font-black text-xl tracking-tight text-center"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-1"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Devolução Registrada</p></div>';
          ssb.classList.remove('hidden');
        }
        setTimeout(() => this.reset(), 2000);
      } catch (err) {
        window.Logger.error('Erro ao processar devolução', err);
        window.App.UI.showToast('Falha de comunicação com o banco. Tente novamente.', 'error');
        document.getElementById('scanner-processing')?.classList.add('hidden');
        document.getElementById('scanner-return')?.classList.remove('hidden');
      }
    }, 500);
  },
  processCheckout: function () {
    const bV = window.Utils.removeAccents(
      document.getElementById('checkout-user-badge')?.value.trim() || ''
    ).toLowerCase();
    if (!bV || !this.currentTool) {
      return;
    }
    const u = window.App.Data.collaborators.find(
      (x) =>
        ((x.badge !== null &&
          x.badge !== undefined &&
          window.Utils.removeAccents(x.badge).toLowerCase() === bV) ||
          window.Utils.removeAccents(x.name).toLowerCase() === bV)
    );
    if (!u) {
      window.AudioSys.playBeep('error');
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
      return window.App.UI.showToast('Colaborador não localizado.', 'error');
    }
    if (u.status === 'inactive') {
      window.AudioSys.playBeep('error');
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
      return window.App.UI.showToast('Colaborador bloqueado/inativo.', 'error');
    }
    ['scanner-checkout', 'scanner-status-box'].forEach((id) =>
      document.getElementById(id)?.classList.add('hidden')
    );
    document.getElementById('scanner-processing')?.classList.remove('hidden');
    setTimeout(async () => {
      try {
        await requestToolMovement({
          action: 'loan',
          toolId: this.currentTool.firebaseId,
          collaboratorId: u.firebaseId,
          device:
            window.App.Session.currentDevice ||
            window.navigator.userAgent ||
            'Navegador'
        });
        window.AudioSys.playBeep('success');
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(100);
        }
        window.App.UI.showToast(`Autorizada para ${u.name}`, 'success');

        if (window.App.PDF && typeof window.App.PDF.generateReceipt === 'function') {
          window.App.PDF.generateReceipt(this.currentTool, u.name);
        } else {
          window.Logger.warn('Módulo PDF ausente. O recibo não foi gerado.');
        }

        metrics.trackAction('tools', 'checkout', this.currentTool.code);
        metrics.increment('tools.borrowed_total');

        document.getElementById('scanner-processing')?.classList.add('hidden');
        const rbc = document.getElementById('res-badge-container');
        if (rbc) {
          rbc.innerHTML = window.Utils.getBadgeHTML('borrowed');
        }
        const ssb = document.getElementById('scanner-status-box');
        if (ssb) {
          ssb.innerHTML = `<div class="text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 p-6 rounded-2xl border border-amber-200 dark:border-amber-800 shadow-sm text-center"><p class="font-black text-xl tracking-tight">Responsabilidade Transferida</p><p class="text-sm font-bold mt-2 opacity-80">Guarda: ${window.Utils.escapeHTML(u.name)}</p></div>`;
          ssb.classList.remove('hidden');
        }
        setTimeout(() => this.reset(), 3000);
      } catch (err) {
        window.Logger.error('Erro no processCheckout:', err);
        window.App.UI.showToast('Falha de comunicação com o banco. Tente novamente.', 'error');
        document.getElementById('scanner-processing')?.classList.add('hidden');
        document.getElementById('scanner-checkout')?.classList.remove('hidden');
      }
    }, 500);
  },
  reset: function () {
    this.currentTool = null;
    document.getElementById('scanner-result')?.classList.add('hidden');
    document.getElementById('scanner-waiting')?.classList.remove('hidden');

    const quickActions = document.getElementById('scanner-quick-actions');
    if (quickActions) {
      quickActions.classList.add('hidden');
    }

    const msi = document.getElementById('manual-scan-input');
    if (msi) {
      msi.value = '';
    }
    const sli = document.getElementById('scanner-line-indicator');
    if (sli) {
      sli.className =
        'absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-500 via-indigo-500 to-brand-500';
    }
    if (this.currentMode === 'cam') {
      this.startCamera();
    }
    this.focus();
  },
  quickAction: function (action) {
    if (!this.currentTool) {
      return;
    }

    switch (action) {
      case 'loan':
        document.getElementById('scanner-checkout')?.classList.remove('hidden');
        document.getElementById('checkout-user-badge')?.focus();
        break;
      case 'return':
        this.processReturn();
        break;
      case 'details': {
        window.App.UI.switchTab('management');
        const searchInput = document.getElementById('tools-search');
        if (searchInput) {
          searchInput.value = this.currentTool.code;
          searchInput.dispatchEvent(new Event('input'));
        }
        break;
      }
    }
  }
};
