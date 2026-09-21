import { metrics } from '../core/MetricsManager.js';
import { auth } from '../app.js';

async function requestToolMovement(body) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error('Sua sessão expirou. Entre novamente.');
  }

  if (
    !body?.toolId ||
    (body.action === 'loan' && (!body.toolCode || !body.collaboratorBadge))
  ) {
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
    const error = new Error(
      payload?.message || 'Não foi possível registrar a movimentação.'
    );
    error.code = payload?.code;
    error.status = response.status;
    throw error;
  }

  return payload.data || null;
}

// Código devolvido pela API quando o crachá informado não pode ser usado (qualquer perfil).
const LOAN_NOT_AUTHORIZED = 'LOAN_NOT_AUTHORIZED';

const isMaintenanceOverdue = (tool) =>
  Boolean(tool?.nextMaintenance) && new Date(tool.nextMaintenance).getTime() < Date.now();

export const AppScanner = {
  currentTool: null,
  // Patrimônio exatamente como lido nesta operação (a API confere com o da ferramenta).
  currentToolCode: null,
  checkoutInFlight: false,
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

    // "Confirmar Empréstimo" só habilita com ferramenta lida + crachá preenchido.
    document
      .getElementById('checkout-user-badge')
      ?.addEventListener('input', () => this.syncCheckoutButton());
    this.syncCheckoutButton();

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

    // Nova leitura = nova operação: nada da anterior (ferramenta, patrimônio, crachá) é reaproveitado.
    this.clearCheckoutBadge();
    this.currentTool = t;
    this.currentToolCode = String(c).trim();
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
      // Revisão/calibração vencida: o formulário de retirada nem aparece (a API também recusa).
      if (isMaintenanceOverdue(t)) {
        window.AudioSys.playBeep('error');
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
        return window.App.UI.showToast(
          'Empréstimo bloqueado: Ferramenta com revisão/calibração vencida.',
          'error'
        );
      }

      const bStat = document.getElementById('scanner-status-box');
      if (bStat) {
        bStat.innerHTML = '<div class="flex items-start text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 p-5 rounded-xl border border-emerald-200 dark:border-emerald-800 shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 mr-4 mt-0.5 text-emerald-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><div><p class="font-extrabold text-lg tracking-tight">Pronta para Uso</p><p class="text-sm font-medium mt-1">Autorize a retirada abaixo.</p></div></div>';
        bStat.classList.remove('hidden');
      }
      this.openCheckout();
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
  // Empréstimo (todos os perfis): ferramenta lida nesta operação + crachá do colaborador. O cliente
  // não resolve o colaborador (nem por nome, nem pela lista): envia o crachá exato e o patrimônio
  // lido; a API confere o patrimônio, resolve o crachá e grava movimento + status juntos.
  processCheckout: function () {
    const badge = document.getElementById('checkout-user-badge')?.value.trim() || '';
    // Identidades capturadas agora: um reset durante o envio não troca a operação em andamento.
    const tool = this.currentTool;
    const toolCode = this.currentToolCode;

    if (!badge || !tool || !toolCode || this.checkoutInFlight) {
      return;
    }
    this.checkoutInFlight = true;
    this.syncCheckoutButton();

    ['scanner-checkout', 'scanner-status-box'].forEach((id) =>
      document.getElementById(id)?.classList.add('hidden')
    );
    document.getElementById('scanner-processing')?.classList.remove('hidden');
    setTimeout(async () => {
      try {
        const movement = await requestToolMovement({
          action: 'loan',
          toolId: tool.firebaseId,
          toolCode,
          collaboratorBadge: badge,
          device:
            window.App.Session.currentDevice ||
            window.navigator.userAgent ||
            'Navegador'
        });
        // Nome e função vêm da resposta da própria movimentação autorizada.
        const borrower = movement.collaborator;
        window.AudioSys.playBeep('success');
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(100);
        }
        window.App.UI.showToast(`Autorizada para ${borrower.name}`, 'success');

        if (window.App.PDF && typeof window.App.PDF.generateReceipt === 'function') {
          window.App.PDF.generateReceipt(tool, borrower.name, { badge, role: borrower.role });
        } else {
          window.Logger.warn('Módulo PDF ausente. O recibo não foi gerado.');
        }

        metrics.trackAction('tools', 'checkout', tool.code);
        metrics.increment('tools.borrowed_total');

        this.clearCheckoutBadge();
        document.getElementById('scanner-processing')?.classList.add('hidden');
        const rbc = document.getElementById('res-badge-container');
        if (rbc) {
          rbc.innerHTML = window.Utils.getBadgeHTML('borrowed');
        }
        const ssb = document.getElementById('scanner-status-box');
        if (ssb) {
          ssb.innerHTML = `<div class="text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 p-6 rounded-2xl border border-amber-200 dark:border-amber-800 shadow-sm text-center"><p class="font-black text-xl tracking-tight">Responsabilidade Transferida</p><p class="text-sm font-bold mt-2 opacity-80">Guarda: ${window.Utils.escapeHTML(borrower.name)}</p></div>`;
          ssb.classList.remove('hidden');
        }
        setTimeout(() => this.reset(), 3000);
      } catch (err) {
        document.getElementById('scanner-processing')?.classList.add('hidden');
        if (err.code === LOAN_NOT_AUTHORIZED) {
          // Resposta genérica do servidor (crachá desconhecido, duplicado ou inativo): sem detalhes.
          window.AudioSys.playBeep('error');
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
          }
          window.App.UI.showToast(err.message, 'error');
          this.openCheckout({ keepBadge: true });
          return;
        }
        if (err.status >= 400 && err.status < 500) {
          // Recusa de negócio (ferramenta indisponível, patrimônio divergente, revisão vencida):
          // a operação termina; uma nova leitura começa do zero.
          window.AudioSys.playBeep('error');
          window.App.UI.showToast(err.message, 'error');
          setTimeout(() => this.reset(), 3000);
          return;
        }
        window.Logger.error('Erro no processCheckout:', err);
        window.App.UI.showToast('Falha de comunicação com o banco. Tente novamente.', 'error');
        this.openCheckout({ keepBadge: true });
      } finally {
        this.checkoutInFlight = false;
        this.syncCheckoutButton();
      }
    }, 500);
  },
  // Mostra o formulário de retirada da ferramenta lida. Todos os perfis informam o crachá.
  openCheckout: function ({ keepBadge = false } = {}) {
    if (!keepBadge) {
      this.clearCheckoutBadge();
    }
    document.getElementById('scanner-checkout')?.classList.remove('hidden');
    const bi = document.getElementById('checkout-user-badge');
    if (bi) {
      bi.placeholder = 'Crachá do colaborador';
      setTimeout(() => bi.focus(), 100);
    }
    this.syncCheckoutButton();
  },
  clearCheckoutBadge: function () {
    const bi = document.getElementById('checkout-user-badge');
    if (bi) {
      bi.value = '';
    }
    this.syncCheckoutButton();
  },
  syncCheckoutButton: function () {
    const button = document.getElementById('btn-checkout-confirm');
    if (!button) {
      return;
    }
    const badge = document.getElementById('checkout-user-badge')?.value.trim() || '';
    button.disabled = !(this.currentTool && this.currentToolCode && badge) || this.checkoutInFlight;
  },
  // Encerra a operação atual sem mexer em câmera nem foco (usado ao sair da aba do Scanner).
  clearOperation: function () {
    this.currentTool = null;
    this.currentToolCode = null;
    this.clearCheckoutBadge();
    ['scanner-result', 'scanner-checkout', 'scanner-return', 'scanner-processing'].forEach((id) =>
      document.getElementById(id)?.classList.add('hidden')
    );
    document.getElementById('scanner-waiting')?.classList.remove('hidden');
    document.getElementById('scanner-quick-actions')?.classList.add('hidden');

    const msi = document.getElementById('manual-scan-input');
    if (msi) {
      msi.value = '';
    }
    const sli = document.getElementById('scanner-line-indicator');
    if (sli) {
      sli.className =
        'absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-500 via-indigo-500 to-brand-500';
    }
  },
  reset: function () {
    this.clearOperation();
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
      case 'loan': {
        // Confere o estado atual (não o da leitura): só abre a retirada para ferramenta disponível.
        const live =
          window.App.Data.tools.find((t) => t.firebaseId === this.currentTool.firebaseId) ||
          this.currentTool;
        if (live.status !== 'available' || isMaintenanceOverdue(live)) {
          window.App.UI.showToast('Ferramenta indisponível para empréstimo.', 'warning');
          return;
        }
        this.openCheckout({ keepBadge: true });
        break;
      }
      case 'return':
        this.processReturn();
        break;
      case 'details': {
        // Sair da aba encerra a operação (clearOperation): guarda o código antes.
        const code = this.currentTool.code;
        window.App.UI.switchTab('management');
        const searchInput = document.getElementById('tools-search');
        if (searchInput) {
          searchInput.value = code;
          searchInput.dispatchEvent(new Event('input'));
        }
        break;
      }
    }
  }
};
