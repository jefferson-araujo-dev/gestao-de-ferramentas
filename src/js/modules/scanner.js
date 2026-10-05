import { metrics } from '../core/MetricsManager.js';
import { auth } from '../app.js';
import { setBusy, isBusy } from '../components/index.js';

// Gate 1-F4.C4, Decisão 7: versão do app enviada em toda requisição à Movement API e ao endpoint
// de status, só para registro no servidor (nenhum bloqueio nesta etapa). __APP_VERSION__ é
// substituída em build pelo Vite (vite.config.js) a partir de package.json.
const APP_VERSION_HEADERS = { 'X-App-Version': __APP_VERSION__ };

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
      'Content-Type': 'application/json',
      ...APP_VERSION_HEADERS
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
    // Erro de negócio devolvido pelo servidor (ferramenta/crachá/patrimônio): a mensagem já é
    // apropriada para exibição, diferente de uma falha real de rede/comunicação.
    error.isMovementError = true;
    throw error;
  }

  return payload.data || null;
}

// Gate 1-F4.C4-FIX1: depois de uma resposta 404, 409 ou 429, novas leituras do MESMO código pelo
// Restrito são ignoradas por este intervalo (sem requisição, toast, Recentes nem estatística). Sem
// isso, uma etiqueta não cadastrada parada diante da câmera gera ~1 consulta/s e esgota o limite do
// servidor (10 falhas / 60 s, api/tools/status.js) em ~10 s, bloqueando também ferramentas válidas.
// Precisa ser de pelo menos 7 s: abaixo de 6 s, uma leitura contínua ainda estouraria o limite.
const RESTRICTED_LOOKUP_COOLDOWN_MS = 10 * 1000;
const RESTRICTED_LOOKUP_COOLDOWN_STATUSES = [404, 409, 429];
const LOOKUP_NOT_FOUND_MESSAGE = 'Patrimônio não localizado.';
const LOOKUP_ACCESS_DENIED_MESSAGE = 'Sessão expirada ou acesso não permitido. Entre novamente.';
const LOOKUP_FAILURE_MESSAGE = 'Falha ao consultar a ferramenta. Tente novamente.';

// Mensagem de tela para cada falha da consulta do Restrito, sem dado pessoal nem detalhe interno:
// só 404 é "não localizado"; 409 e 429 usam o texto fixo do servidor; 401/403 indicam sessão ou
// acesso; qualquer outra falha (5xx, rede, resposta inválida) é uma falha genérica da consulta.
function restrictedLookupFailureMessage(status, payload) {
  if (status === 404) {
    return LOOKUP_NOT_FOUND_MESSAGE;
  }
  if ((status === 409 || status === 429) && typeof payload?.message === 'string') {
    return payload.message;
  }
  if (status === 401 || status === 403) {
    return LOOKUP_ACCESS_DENIED_MESSAGE;
  }
  return LOOKUP_FAILURE_MESSAGE;
}

// Gate 1-F4.C4, Decisão 1 (B1): caminho do Restrito para obter status/dados da ferramenta, sem
// abrir o listener de `tools` (que grava `currentUser`/`currentCollaboratorId`, docs/design/
// USERS_AUDIT_SCREEN.md, seção C.2). Sempre POST com `cache: 'no-store'` (E.2 do mesmo documento):
// o service worker grava todo GET da mesma origem em CacheStorage, compartilhado entre usuários.
// Resultado: `{ tool }` no sucesso, com os campos de B1 no formato que Admin/Padrão recebem pelo
// listener (miniatura e manutenção vencida funcionam igual); `{ tool: null, message, status }` em
// qualquer falha, com `status` HTTP (null sem sessão ou sem resposta) e `message` de
// restrictedLookupFailureMessage.
async function fetchRestrictedToolStatus(code) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    return { tool: null, message: LOOKUP_ACCESS_DENIED_MESSAGE, status: null };
  }

  try {
    const token = await currentUser.getIdToken();
    const response = await fetch('/api/tools/status', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...APP_VERSION_HEADERS
      },
      body: JSON.stringify({ code }),
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.success !== true || !payload.data?.tool) {
      return {
        tool: null,
        message: restrictedLookupFailureMessage(response.status, payload),
        status: response.status
      };
    }

    const tool = payload.data.tool;

    return {
      tool: {
        firebaseId: tool.id,
        code: tool.code,
        name: tool.name,
        category: tool.category,
        status: tool.status,
        imageUrl: tool.imageUrl ?? null,
        nextMaintenance: tool.nextMaintenance ?? null
      },
      message: null,
      status: response.status
    };
  } catch (err) {
    window.Logger.warn('Erro ao consultar status da ferramenta (Restrito)', err);
    return { tool: null, message: LOOKUP_FAILURE_MESSAGE, status: null };
  }
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

    document.getElementById('checkout-user-badge')?.addEventListener('input', () => {
      this.clearBadgeError();
      this.updateLoanSummary();
    });

    // Mitigação mínima para teclado virtual (mobile): ao focar o crachá, garante que o campo e o
    // botão de confirmar fiquem alcançáveis mesmo com o teclado ocupando parte da viewport. Não
    // simula um teclado real (Playwright/Chromium não redimensionam a viewport para isso); a
    // verificação em dispositivo físico continua pendente e está registrada no REPORT.
    document.getElementById('checkout-user-badge')?.addEventListener('focus', (e) => {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      e.target.scrollIntoView({
        block: 'nearest',
        behavior: reduceMotion ? 'auto' : 'smooth'
      });
    });

    this.loadStats();
  },

  showBadgeError: function (message, { invalid = true } = {}) {
    const input = document.getElementById('checkout-user-badge');
    const errEl = document.getElementById('checkout-badge-error');
    if (input && invalid) {
      input.setAttribute('aria-invalid', 'true');
    }
    if (errEl) {
      errEl.textContent = message;
      errEl.classList.remove('hidden');
    }
  },

  clearBadgeError: function () {
    const input = document.getElementById('checkout-user-badge');
    const errEl = document.getElementById('checkout-badge-error');
    if (input) {
      input.removeAttribute('aria-invalid');
    }
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }
  },

  showReturnError: function (message) {
    const errEl = document.getElementById('return-error');
    if (errEl) {
      errEl.textContent = message;
      errEl.classList.remove('hidden');
    }
  },

  clearReturnError: function () {
    const errEl = document.getElementById('return-error');
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }
  },

  updateLoanSummary: function () {
    const badgeInput = document.getElementById('checkout-user-badge');
    const el = document.getElementById('loan-summary-badge');
    if (el) {
      const val = badgeInput?.value.trim();
      el.textContent = val ? val : '—';
    }
  },

  showBlocked: function (title, message) {
    const titleEl = document.getElementById('scanner-blocked-title');
    const msgEl = document.getElementById('scanner-blocked-message');
    if (titleEl) {
      titleEl.textContent = title;
    }
    if (msgEl) {
      msgEl.textContent = message;
    }
    document.getElementById('scanner-blocked')?.classList.remove('hidden');
    document.getElementById('scanner-success-actions')?.classList.remove('hidden');
    document.getElementById('scanner-blocked')?.focus();
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
    if (m !== this.currentMode) {
      this.clearOperation();
    }
    this.currentMode = m;
    const a =
        'w-full sm:w-auto flex items-center justify-center px-3 sm:px-4 py-2.5 bg-brand-600 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-brand-600/20 hover:scale-105 active:scale-95 min-h-11',
      ia =
        'w-full sm:w-auto flex items-center justify-center px-3 sm:px-4 py-2.5 bg-slate-700 text-slate-300 font-bold rounded-xl text-sm hover:bg-slate-600 transition-all hover:scale-105 active:scale-95 min-h-11';
    const u = document.getElementById('btn-mode-usb'),
      c = document.getElementById('btn-mode-cam');
    if (u) {
      u.className = m === 'usb' ? a : ia;
      u.setAttribute('aria-pressed', String(m === 'usb'));
    }
    if (c) {
      c.className = m === 'cam' ? a : ia;
      c.setAttribute('aria-pressed', String(m === 'cam'));
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
      const torchBtn = document.getElementById('btn-toggle-torch');
      if (torchBtn) {
        torchBtn.setAttribute('aria-pressed', 'false');
        torchBtn.setAttribute('aria-label', 'Ligar lanterna');
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
      const torchBtn = document.getElementById('btn-toggle-torch');
      if (torchBtn) {
        torchBtn.setAttribute('aria-pressed', String(this.isTorchOn));
        torchBtn.setAttribute('aria-label', this.isTorchOn ? 'Desligar lanterna' : 'Ligar lanterna');
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
      const torchBtn = document.getElementById('btn-toggle-torch');
      if (torchBtn) {
        torchBtn.setAttribute('aria-pressed', 'false');
        torchBtn.setAttribute('aria-label', 'Ligar lanterna');
      }
    }
  },
  focus: function () {
    const h = document.getElementById('hidden-scanner');
    if (!this.currentTool && this.currentMode === 'usb' && h) {
      h.focus();
    }
  },
  // Ponto de entrada dos leitores (USB, campo manual, câmera), que não aguardam a promessa: nunca
  // rejeita (Gate 1-F4.C4). Erro inesperado só é registrado, como antes, quando a busca era
  // síncrona e o erro não chegava a nenhuma mensagem de tela.
  processCode: function (c) {
    return this._processCode(c).catch((err) => {
      window.Logger.error('Erro ao processar o código lido.', err);
    });
  },
  _lookupSeq: 0,
  // Restrito (Gate 1-F4.C4-FIX1): código -> instante até o qual novas leituras dele são ignoradas
  // (ver RESTRICTED_LOOKUP_COOLDOWN_MS). Só em memória, só o código lido — nunca dado de pessoa;
  // logout e troca de usuário recarregam a página (auth.js) e o descartam junto.
  _lookupCooldown: new Map(),
  _lookupsInFlight: 0,
  // Códigos com consulta ainda sem resposta: releitura do mesmo código nesse intervalo também é
  // ignorada (o cooldown só nasce com a resposta; com rede lenta, cada releitura viraria uma nova
  // consulta e uma nova falha contada pelo servidor).
  _pendingLookupCodes: new Set(),
  _cooldownCameraRestart: false,
  _isLookupCoolingDown: function (code) {
    const until = this._lookupCooldown.get(code);
    if (until === undefined) {
      return false;
    }
    if (until > Date.now()) {
      return true;
    }
    this._lookupCooldown.delete(code);
    return false;
  },
  _processCode: async function (c) {
    const startTime = Date.now();
    const isRestricted = window.App.Auth.isRestricted === true;
    const lookupCode = c.trim();

    // Leitura repetida de um código em cooldown: ignorada por inteiro. A câmera para a cada leitura
    // (callback em startCamera), então é religada — sem limpar nada — só no Scanner, sem operação
    // aberta, sem consulta em andamento (a resposta dela decide o que fazer com a câmera) e sem
    // outra religação desta mesma origem ainda em curso (startCamera espera 500 ms antes de ligar).
    if (isRestricted && this._pendingLookupCodes.has(lookupCode)) {
      return;
    }
    if (isRestricted && this._isLookupCoolingDown(lookupCode)) {
      if (
        this.currentMode === 'cam' &&
        !this.currentTool &&
        window.App.UI.activeTab === 'scanner' &&
        this._lookupsInFlight === 0 &&
        !this._cooldownCameraRestart
      ) {
        this._cooldownCameraRestart = true;
        Promise.resolve(this.startCamera()).finally(() => {
          this._cooldownCameraRestart = false;
        });
      }
      return;
    }
    // Restrito (Gate 1-F4.C4, Decisão 1/B1): consulta o endpoint dedicado, nunca o cache local de
    // `tools` (que o Restrito não recebe mais, ver auth.js `_setPermissions`). Admin e Padrão
    // continuam com a busca local, síncrona, igual a antes.
    const searchCode = window.Utils.removeAccents(c).toLowerCase();
    const findLocalTool = () =>
      window.App.Data.tools.find(
        (x) =>
          x.code !== null &&
          x.code !== undefined &&
          window.Utils.removeAccents(x.code).toLowerCase() === searchCode
      );
    const lookupSeq = ++this._lookupSeq;
    let lookup;
    if (isRestricted) {
      this._lookupsInFlight += 1;
      this._pendingLookupCodes.add(lookupCode);
      try {
        lookup = await fetchRestrictedToolStatus(lookupCode);
      } finally {
        this._lookupsInFlight -= 1;
        this._pendingLookupCodes.delete(lookupCode);
      }
    } else {
      lookup = { tool: findLocalTool(), message: null };
    }

    // Antes do descarte abaixo: a falha já contou no servidor mesmo que a resposta chegue atrasada.
    if (isRestricted && RESTRICTED_LOOKUP_COOLDOWN_STATUSES.includes(lookup.status)) {
      this._lookupCooldown.set(lookupCode, Date.now() + RESTRICTED_LOOKUP_COOLDOWN_MS);
    }

    // Restrito (único caminho assíncrono): resposta que chega depois de outra leitura, de uma troca
    // de aba ou do fim da operação (clearOperation) é descartada — não pode reabrir uma operação
    // abandonada. A busca local de Admin/Padrão é síncrona e segue sem essa verificação.
    if (
      isRestricted &&
      (lookupSeq !== this._lookupSeq || window.App.UI.activeTab !== 'scanner')
    ) {
      return;
    }

    const t = lookup.tool;

    if (!t) {
      window.AudioSys.playBeep('error');
      // Feedback tátil de erro (vibração dupla) em dispositivos suportados
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }

      window.App.UI.showToast(lookup.message || LOOKUP_NOT_FOUND_MESSAGE, 'error');

      this.scanStats.today++;
      this.scanStats.errors++;
      this.saveStats();
      this.updateStatsDisplay();

      // Restrito (Gate 1-F4.C4-FIX1): "Não encontrado" só quando o servidor respondeu 404. Em 409,
      // 429, 401/403, 5xx ou falha de rede o código pode ser de uma ferramenta real, então nada
      // entra em Últimas Leituras. Admin/Padrão: busca local, sem mudança.
      if (!isRestricted || lookup.status === 404) {
        this.addRecentScan(
          {
            code: c,
            name: 'Não encontrado',
            status: 'error'
          },
          false
        );
      }

      const resultEl = document.getElementById('scanner-result');
      if (resultEl) {
        resultEl.classList.add('scan-error');
        setTimeout(() => resultEl.classList.remove('scan-error'), 500);
      }

      return this._restart();
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
    sT('res-category', t.category);
    sT('res-name', t.name);
    sT('res-code', t.code);
    sT('loan-summary-name', t.name);
    sT('loan-summary-code', t.code);
    const rbdg = document.getElementById('res-badge-container');
    if (rbdg) {
      rbdg.innerHTML = window.Utils.getBadgeHTML(t.status);
    }

    const quickActions = document.getElementById('scanner-quick-actions');
    if (quickActions) {
      // "Ver detalhes" leva à tela Ferramentas, oculta e bloqueada para o Restrito (Gate 1-F4.C4,
      // Decisão 2a): sem isso, o botão ficaria visível apontando para uma tela inacessível.
      quickActions.classList.toggle('hidden', isRestricted);
    }

    [
      'scanner-status-box',
      'scanner-checkout',
      'scanner-processing',
      'scanner-return',
      'scanner-blocked',
      'scanner-success-actions'
    ].forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    this.clearBadgeError();
    this.clearReturnError();

    if (t.status === 'borrowed') {
      const rui = document.getElementById('return-user-info');
      if (rui) {
        // Restrito (Gate 1-F4.C4, Decisão 1/B1): `t.currentUser` nunca existe (o endpoint de
        // status não devolve dado de colaborador), então nada é exibido aqui — nem o rótulo
        // "Responsável atual", nem um texto de fallback — em vez do nome do colaborador.
        rui.innerHTML = isRestricted
          ? ''
          : t.currentUser
            ? `Responsável atual: <strong>${window.Utils.escapeHTML(t.currentUser)}</strong>`
            : '<strong>Responsável não informado</strong>';
        // Vazio no Restrito: oculto, para não deixar linha vazia no bloco da devolução.
        rui.classList.toggle('hidden', isRestricted);
      }
      document.getElementById('scanner-return')?.classList.remove('hidden');
      this.closeAdminReturn();
      const rbi = document.getElementById('return-user-badge');
      if (rbi) {
        rbi.value = '';
      }
      // Devolução administrativa (Gate 1-F4.C3): disponível para Admin e Padrão, nunca para o
      // Restrito — mesma regra de autorização já aplicada no servidor (api/tools/movement.js).
      const adminReturnBtn = document.getElementById('btn-return-admin-open');
      if (adminReturnBtn) {
        adminReturnBtn.classList.toggle('hidden', isRestricted);
      }
      setTimeout(() => rbi?.focus(), 100);
    } else if (t.status === 'available') {
      const overdue = t.nextMaintenance && new Date(t.nextMaintenance).getTime() < Date.now();
      if (overdue) {
        window.AudioSys.playBeep('error');
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
        window.App.UI.showToast(
          'Empréstimo bloqueado: Ferramenta com revisão/calibração vencida.',
          'error'
        );
        return this.showBlocked(
          'Empréstimo indisponível',
          'A revisão/calibração desta ferramenta está vencida.'
        );
      }

      const bStat = document.getElementById('scanner-status-box');
      if (bStat) {
        bStat.innerHTML = '<div class="flex items-start text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 p-5 rounded-xl border border-emerald-200 dark:border-emerald-800 shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 mr-4 mt-0.5 text-emerald-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><div><p class="font-extrabold text-lg tracking-tight">Pronta para Uso</p><p class="text-sm font-medium mt-1">Autorize a retirada abaixo.</p></div></div>';
        bStat.classList.remove('hidden');
      }
      document.getElementById('scanner-checkout')?.classList.remove('hidden');
      const bi = document.getElementById('checkout-user-badge');
      if (bi) {
        bi.value = '';
        // Identificação sempre por crachá/ponto, para todos os perfis: nome não é aceito no
        // lugar do crachá (a resolução do colaborador é sempre feita pelo servidor, por crachá).
        bi.placeholder = 'Crachá do colaborador';
        this.updateLoanSummary();
        setTimeout(() => bi.focus(), 100);
      }
    } else {
      window.AudioSys.playBeep('error');
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
      window.App.UI.showToast('Em Manutenção ativa.', 'warning');
      this.showBlocked('Operação indisponível', 'Esta ferramenta está em manutenção.');
    }
  },
  // Devolução comum (Gate 1-F4.C3): exige o crachá de quem está devolvendo, para todos os perfis —
  // o servidor compara com o `currentCollaboratorId` do empréstimo e responde só CONFERE/NÃO
  // CONFERE (err.message já vem pronto para exibição, sem dado pessoal, em qualquer dos dois casos).
  processReturn: function () {
    const btn = document.getElementById('btn-return-confirm');
    if (isBusy(btn) || !this.currentTool) {
      return;
    }
    const badgeInput = document.getElementById('return-user-badge');
    const typedBadge = badgeInput?.value.trim() || '';
    if (!typedBadge) {
      this.showReturnError('Informe o crachá de quem está devolvendo.');
      badgeInput?.focus();
      return;
    }
    this.clearReturnError();
    setBusy(btn, true);
    document.getElementById('scanner-return')?.classList.add('hidden');
    document.getElementById('scanner-processing')?.classList.remove('hidden');
    setTimeout(async () => {
      try {
        await requestToolMovement({
          action: 'return',
          toolId: this.currentTool.firebaseId,
          collaboratorBadge: typedBadge,
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
        setBusy(btn, false);
        document.getElementById('scanner-processing')?.classList.add('hidden');
        const rbc = document.getElementById('res-badge-container');
        if (rbc) {
          rbc.innerHTML = window.Utils.getBadgeHTML('available');
        }
        const ssb = document.getElementById('scanner-status-box');
        if (ssb) {
          ssb.innerHTML = '<div class="text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 p-6 rounded-2xl border border-emerald-200 dark:border-emerald-800 shadow-sm"><p class="font-black text-xl tracking-tight text-center"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-1"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Devolução Registrada</p></div>';
          ssb.classList.remove('hidden');
          ssb.focus();
        }
        document.getElementById('scanner-success-actions')?.classList.remove('hidden');
      } catch (err) {
        setBusy(btn, false);
        document.getElementById('scanner-processing')?.classList.add('hidden');
        document.getElementById('scanner-return')?.classList.remove('hidden');

        if (err.isMovementError) {
          // NÃO CONFERE ou outra falha de negócio: mensagem já pronta para exibição pelo servidor,
          // sem nome/crachá/função do colaborador em nenhum caso.
          window.AudioSys.playBeep('error');
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
          }
          this.showReturnError(err.message);
        } else {
          window.Logger.error('Erro ao processar devolução', err);
          this.showReturnError('Falha de comunicação com o banco. Tente novamente.');
        }

        badgeInput?.focus();
      }
    }, 500);
  },
  // Devolução administrativa (Gate 1-F4.C3, decisão do Cowork): Admin e Padrão, nunca o Restrito
  // (botão de acesso já fica oculto para o Restrito — ver identify()); ignora a conferência de
  // crachá. `reason` é obrigatório (o servidor valida 10-500 caracteres; a checagem local só evita
  // uma viagem ao servidor para o caso mais comum de campo vazio/curto demais).
  openAdminReturn: function () {
    this.clearReturnError();
    document.getElementById('return-badge-step')?.classList.add('hidden');
    document.getElementById('return-admin-step')?.classList.remove('hidden');
    const reasonInput = document.getElementById('return-admin-reason');
    if (reasonInput) {
      reasonInput.value = '';
    }
    setTimeout(() => document.getElementById('return-admin-reason')?.focus(), 100);
  },
  closeAdminReturn: function () {
    document.getElementById('return-admin-step')?.classList.add('hidden');
    document.getElementById('return-badge-step')?.classList.remove('hidden');
  },
  processReturnAdmin: function () {
    const btn = document.getElementById('btn-return-admin-confirm');
    if (isBusy(btn) || !this.currentTool) {
      return;
    }
    const reasonInput = document.getElementById('return-admin-reason');
    const reason = reasonInput?.value.trim() || '';
    if (reason.length < 10) {
      this.showReturnError('Descreva o motivo com pelo menos 10 caracteres.');
      reasonInput?.focus();
      return;
    }
    this.clearReturnError();
    setBusy(btn, true);
    document.getElementById('scanner-return')?.classList.add('hidden');
    document.getElementById('scanner-processing')?.classList.remove('hidden');
    setTimeout(async () => {
      try {
        await requestToolMovement({
          action: 'return_admin',
          toolId: this.currentTool.firebaseId,
          reason,
          device:
            window.App.Session.currentDevice ||
            window.navigator.userAgent ||
            'Navegador'
        });
        window.AudioSys.playBeep('success');
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(100);
        }
        window.App.UI.showToast('Devolução administrativa registrada.', 'success');
        setBusy(btn, false);
        document.getElementById('scanner-processing')?.classList.add('hidden');
        const rbc = document.getElementById('res-badge-container');
        if (rbc) {
          rbc.innerHTML = window.Utils.getBadgeHTML('available');
        }
        const ssb = document.getElementById('scanner-status-box');
        if (ssb) {
          ssb.innerHTML = '<div class="text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 p-6 rounded-2xl border border-emerald-200 dark:border-emerald-800 shadow-sm"><p class="font-black text-xl tracking-tight text-center"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-1"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Devolução Registrada</p></div>';
          ssb.classList.remove('hidden');
          ssb.focus();
        }
        document.getElementById('scanner-success-actions')?.classList.remove('hidden');
      } catch (err) {
        setBusy(btn, false);
        document.getElementById('scanner-processing')?.classList.add('hidden');
        document.getElementById('scanner-return')?.classList.remove('hidden');
        document.getElementById('return-badge-step')?.classList.add('hidden');
        document.getElementById('return-admin-step')?.classList.remove('hidden');

        if (err.isMovementError) {
          window.AudioSys.playBeep('error');
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
          }
          this.showReturnError(err.message);
        } else {
          window.Logger.error('Erro ao processar devolução administrativa', err);
          this.showReturnError('Falha de comunicação com o banco. Tente novamente.');
        }

        reasonInput?.focus();
      }
    }, 500);
  },
  processCheckout: function () {
    const btn = document.getElementById('btn-checkout-confirm');
    if (isBusy(btn)) {
      return;
    }
    const badgeInput = document.getElementById('checkout-user-badge');
    const typedValue = badgeInput?.value.trim() || '';
    if (!typedValue || !this.currentTool) {
      return;
    }
    // Identificação do colaborador é sempre por crachá/ponto, para todos os perfis (Admin,
    // Standard, Restricted): o cliente nunca resolve o colaborador localmente (nem por badge, nem
    // por nome) nem lê a coleção de colaboradores para o loan. O servidor resolve o crachá
    // informado dentro da mesma transação da movimentação e devolve nome/função na resposta.
    const tool = this.currentTool;
    this.clearBadgeError();
    setBusy(btn, true);
    ['scanner-checkout', 'scanner-status-box'].forEach((id) =>
      document.getElementById(id)?.classList.add('hidden')
    );
    document.getElementById('scanner-processing')?.classList.remove('hidden');
    setTimeout(async () => {
      try {
        const movement = await requestToolMovement({
          action: 'loan',
          toolId: tool.firebaseId,
          toolCode: tool.code,
          collaboratorBadge: typedValue,
          device:
            window.App.Session.currentDevice ||
            window.navigator.userAgent ||
            'Navegador'
        });
        // `collaborator` pode não vir da API (perfil Restrito, a partir do Gate 1-F4.C2): nenhum
        // ponto deste fluxo pode presumir sua presença.
        const borrower = movement.collaborator || null;
        const isRestricted = window.App.Auth.isRestricted === true;
        window.AudioSys.playBeep('success');
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(100);
        }
        window.App.UI.showToast(
          !isRestricted && borrower?.name
            ? `Autorizada para ${borrower.name}`
            : 'Empréstimo registrado.',
          'success'
        );

        if (!window.App.PDF) {
          window.Logger.warn('Módulo PDF ausente. O recibo não foi gerado.');
        } else if (isRestricted) {
          window.App.PDF.generateOperationalReceipt(tool, 'Empréstimo');
        } else if (borrower?.name) {
          window.App.PDF.generateReceipt(tool, borrower.name, {
            badge: typedValue,
            role: borrower.role
          });
        } else {
          window.Logger.warn('Módulo PDF ausente. O recibo não foi gerado.');
        }

        metrics.trackAction('tools', 'checkout', tool.code);
        metrics.increment('tools.borrowed_total');

        setBusy(btn, false);
        document.getElementById('scanner-processing')?.classList.add('hidden');
        const rbc = document.getElementById('res-badge-container');
        if (rbc) {
          rbc.innerHTML = window.Utils.getBadgeHTML('borrowed');
        }
        const ssb = document.getElementById('scanner-status-box');
        if (ssb) {
          ssb.innerHTML =
            !isRestricted && borrower?.name
              ? `<div class="text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 p-6 rounded-2xl border border-amber-200 dark:border-amber-800 shadow-sm text-center"><p class="font-black text-xl tracking-tight">Responsabilidade Transferida</p><p class="text-sm font-bold mt-2 opacity-80">Guarda: ${window.Utils.escapeHTML(borrower.name)}</p></div>`
              : '<div class="text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 p-6 rounded-2xl border border-amber-200 dark:border-amber-800 shadow-sm text-center"><p class="font-black text-xl tracking-tight">Responsabilidade Transferida</p></div>';
          ssb.classList.remove('hidden');
          ssb.focus();
        }
        document.getElementById('scanner-success-actions')?.classList.remove('hidden');
      } catch (err) {
        setBusy(btn, false);
        if (err.isMovementError) {
          // Erro de negócio do servidor: crachá desconhecido/duplicado/inativo (genérico para o
          // Restrito) ou mensagem específica (ferramenta, patrimônio, colaborador) para os demais.
          window.AudioSys.playBeep('error');
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
          }
          window.App.UI.showToast(err.message, 'error');
          document.getElementById('scanner-processing')?.classList.add('hidden');
          document.getElementById('scanner-checkout')?.classList.remove('hidden');
          this.showBadgeError(err.message);
          badgeInput?.focus();
          return;
        }
        window.Logger.error('Erro no processCheckout:', err);
        document.getElementById('scanner-processing')?.classList.add('hidden');
        document.getElementById('scanner-checkout')?.classList.remove('hidden');
        this.showBadgeError('Falha de comunicação com o banco. Tente novamente.', {
          invalid: false
        });
        document.getElementById('btn-checkout-confirm')?.focus();
      }
    }, 500);
  },
  // Limpa a operação corrente (ferramenta identificada, crachá digitado, formulários e estado
  // visual transitório) sem mexer na câmera — usado tanto pelo reset() normal (sucesso/erro de
  // leitura) quanto ao sair da aba Scanner, para que uma operação abandonada não sobreviva a uma
  // troca de aba nem a uma falha de comunicação.
  clearOperation: function () {
    this.currentTool = null;
    // Invalida consulta ao endpoint de status ainda em andamento (ver _processCode).
    this._lookupSeq += 1;
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
    const badgeInput = document.getElementById('checkout-user-badge');
    if (badgeInput) {
      badgeInput.value = '';
    }
    const returnBadgeInput = document.getElementById('return-user-badge');
    if (returnBadgeInput) {
      returnBadgeInput.value = '';
    }
    const returnAdminReason = document.getElementById('return-admin-reason');
    if (returnAdminReason) {
      returnAdminReason.value = '';
    }
    this.closeAdminReturn();
    this.clearBadgeError();
    this.clearReturnError();
    this.updateLoanSummary();
    setBusy(document.getElementById('btn-checkout-confirm'), false);
    setBusy(document.getElementById('btn-return-confirm'), false);
    setBusy(document.getElementById('btn-return-admin-confirm'), false);
    [
      'scanner-checkout',
      'scanner-return',
      'scanner-status-box',
      'scanner-processing',
      'scanner-blocked',
      'scanner-success-actions'
    ].forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    const sli = document.getElementById('scanner-line-indicator');
    if (sli) {
      sli.className =
        'absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-500 via-indigo-500 to-brand-500';
    }
  },
  // Ação explícita do usuário ("Nova operação", "Cancelar"): além de reiniciar, libera o cooldown
  // de leitura do Restrito (Gate 1-F4.C4-FIX1). Para Admin/Padrão o cooldown está sempre vazio.
  reset: function () {
    this._lookupCooldown.clear();
    this._restart();
  },
  // Reinício após falha de leitura: igual a reset(), mas mantém o cooldown recém-registrado.
  _restart: function () {
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
