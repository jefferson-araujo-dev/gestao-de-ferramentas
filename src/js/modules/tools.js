import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { auth, db, DB_BASE_PATH, COLLECTIONS } from '../app.js';

async function requestToolMaintenance(body) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error('Sua sessão expirou. Entre novamente.');
  }

  if (
    !body?.toolId ||
    !body?.performedAt ||
    !body?.device ||
    !Object.hasOwn(body, 'nextMaintenance') ||
    !Object.hasOwn(body, 'notes')
  ) {
    throw new Error('Dados da manutenção incompletos.');
  }

  const token = await currentUser.getIdToken();

  const response = await fetch('/api/tools/maintenance', {
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
      payload?.message || 'Não foi possível registrar a manutenção.'
    );
  }

  return payload.data?.tool || null;
}

export const AppCRUDTools = {
  currentFilter: 'all',
  selectedTools: new Set(),
  manualPreviewUrl: null,

  clearManualPreview: function () {
    if (this.manualPreviewUrl) {
      URL.revokeObjectURL(this.manualPreviewUrl);
      this.manualPreviewUrl = null;
    }
  },

  canManageTools: function () {
    return window.App?.Auth?.permissions?.canManageTools === true;
  },

  restoreSavedManualState: function () {
    const fileName = document.getElementById('manual-file-name');
    const viewButton = document.getElementById('btn-view-manual');
    const savedUrl = viewButton?.dataset.savedManualUrl || '';
    const savedName = viewButton?.dataset.savedManualName || '';

    if (viewButton) {
      viewButton.dataset.manualUrl = savedUrl;
      viewButton.classList.toggle('hidden', !savedUrl);
    }

    if (fileName) {
      fileName.textContent = savedName || (savedUrl ? 'PDF anexado' : 'Nenhum arquivo');
    }
  },

  handleImageSelection: function (event) {
    const input = event?.target;
    const preview = document.getElementById('crud-image-preview');
    const placeholder = document.getElementById('image-placeholder-icon');
    const file = input?.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      input.value = '';
      window.App.UI.showToast('Selecione um arquivo de imagem válido.', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (!preview) {
        return;
      }

      preview.src = String(reader.result || '');
      preview.classList.remove('hidden');
      placeholder?.classList.add('hidden');
    };
    reader.onerror = (error) => {
      input.value = '';
      window.Logger.error('Erro ao preparar a prévia da imagem.', error);
      window.App.UI.showToast('Não foi possível visualizar a imagem selecionada.', 'error');
    };
    reader.readAsDataURL(file);
  },

  handleManualSelection: function (event) {
    const input = event?.target;
    const fileName = document.getElementById('manual-file-name');
    const viewButton = document.getElementById('btn-view-manual');
    const file = input?.files?.[0];

    this.clearManualPreview();

    if (!file) {
      this.restoreSavedManualState();
      return;
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      input.value = '';
      this.restoreSavedManualState();
      window.App.UI.showToast('Selecione um arquivo PDF válido.', 'warning');
      return;
    }

    this.manualPreviewUrl = URL.createObjectURL(file);

    if (viewButton) {
      viewButton.dataset.manualUrl = this.manualPreviewUrl;
      viewButton.classList.remove('hidden');
    }

    if (fileName) {
      fileName.textContent = file.name;
    }
  },

  viewManual: function (event) {
    event?.preventDefault();

    const viewButton = document.getElementById('btn-view-manual');
    const manualUrl = viewButton?.dataset.manualUrl;

    if (!manualUrl) {
      window.App.UI.showToast('Nenhum manual disponível.', 'warning');
      return;
    }

    let viewUrl = manualUrl;
    let shouldRevoke = false;

    if (manualUrl.startsWith('data:application/pdf;base64,')) {
      try {
        const encodedData = manualUrl.slice(manualUrl.indexOf(',') + 1);
        const binary = atob(encodedData);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }

        viewUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        shouldRevoke = true;
      } catch (error) {
        window.Logger.error('Erro ao preparar o manual para visualização.', error);
        window.App.UI.showToast('Não foi possível abrir o manual.', 'error');
        return;
      }
    } else if (!/^(https?:|blob:)/i.test(manualUrl)) {
      window.App.UI.showToast('O endereço do manual é inválido.', 'error');
      return;
    }

    const link = document.createElement('a');
    link.href = viewUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();

    if (shouldRevoke) {
      window.setTimeout(() => URL.revokeObjectURL(viewUrl), 60000);
    }
  },

  setQuickFilter: function (filter) {
    this.currentFilter = filter;
    document.querySelectorAll('.inv-filter-btn').forEach((btn) => {
      btn.classList.remove('active');
      if (btn.dataset.filter === filter) {
        btn.classList.add('active');
      }
    });
    this.render();
  },

  isLate: function (t) {
    if (t.status !== 'borrowed' || !t.lastAction) {
      return false;
    }
    const time = new Date(t.lastAction).getTime();
    if (isNaN(time)) {
      return false;
    }
    const diffTime = Date.now() - time;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) > 7;
  },
  getDaysLate: function (t) {
    if (t.status !== 'borrowed' || !t.lastAction) {
      return 0;
    }
    const time = new Date(t.lastAction).getTime();
    if (isNaN(time)) {
      return 0;
    }
    const diffTime = Date.now() - time;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  },
  isMaintenanceDue: function (t) {
    if (!t.nextMaintenance) {
      return false;
    }
    const time = new Date(t.nextMaintenance).getTime();
    if (isNaN(time)) {
      return false;
    }
    return time < Date.now();
  },
  isMaintenanceWarning: function (t) {
    if (!t.nextMaintenance) {
      return false;
    }
    const time = new Date(t.nextMaintenance).getTime();
    if (isNaN(time)) {
      return false;
    }
    const diffDays = Math.ceil((time - Date.now()) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 7;
  },

  toggleSelection: function (id) {
    if (this.selectedTools.has(id)) {
      this.selectedTools.delete(id);
    } else {
      this.selectedTools.add(id);
    }
    this.updateBulkBar();
    this.render();
  },

  selectAll: function () {
    if (this.selectedTools.size === window.App.Data.tools.length) {
      this.selectedTools.clear();
    } else {
      window.App.Data.tools.forEach((t) => this.selectedTools.add(t.firebaseId));
    }
    this.updateBulkBar();
    this.render();
  },

  clearSelection: function () {
    this.selectedTools.clear();
    this.updateBulkBar();
    this.render();
  },

  quickExport: function () {
    if (!this.canManageTools()) {
      window.App.UI.showToast('Acesso restrito a administradores.', 'error');
      return;
    }
    if (!window.XLSX) {
      window.App.UI.showToast('Carregando motor de planilhas...', 'info');
      window.Utils.loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js')
        .then(() => this.quickExport())
        .catch(() => window.App.UI.showToast('Erro ao carregar motor.', 'error'));
      return;
    }
    const data = window.App.Data.tools.map((t) => ({
      Patrimônio: t.code,
      Descrição: t.name,
      Categoria: t.category,
      Status:
        t.status === 'available'
          ? 'Disponível'
          : t.status === 'borrowed'
            ? 'Emprestada'
            : 'Manutenção',
      Responsável: t.currentUser || '',
      'Última Ação': t.lastAction ? new Date(t.lastAction).toLocaleString('pt-BR') : '',
    }));
    const ws = window.XLSX.utils.json_to_sheet(data);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Inventário');
    window.XLSX.writeFile(wb, `inventario_completo_${new Date().toISOString().slice(0, 10)}.xlsx`);
    window.App.UI.showToast(
      `${window.App.Data.tools.length} ferramenta(s) exportada(s).`,
      'success'
    );
  },

  updateBulkBar: function () {
    const bar = document.getElementById('bulk-actions-bar');
    const count = document.getElementById('bulk-selected-count');
    if (bar && count) {
      if (!this.canManageTools()) {
        bar.classList.add('hidden');
        bar.classList.remove('flex');
        count.textContent = '0';
      } else if (this.selectedTools.size > 0) {
        bar.classList.remove('hidden');
        bar.classList.add('flex');
        count.textContent = this.selectedTools.size;
      } else {
        bar.classList.add('hidden');
        bar.classList.remove('flex');
      }
    }
  },

  bulkAction: async function (action, payload = null) {
    if (!this.canManageTools()) {
      window.App.UI.showToast('Acesso restrito a administradores.', 'error');
      return;
    }
    if (this.selectedTools.size === 0) {
      window.App.UI.showToast('Nenhuma ferramenta selecionada.', 'warning');
      return;
    }

    const tools = window.App.Data.tools.filter((t) => this.selectedTools.has(t.firebaseId));

    switch (action) {
      case 'status':
        if (
          !(await window.App.UI.confirmAction('Alterar status em lote?', `Alterar o status de ${tools.length} ferramenta(s) para ${payload === 'available' ? 'Disponível' : 'Manutenção'}?`, 'Alterar'))
        ) {
          return;
        }
        tools.forEach((t) => {
          if (t.status !== 'borrowed') {
            updateDoc(doc(db, DB_BASE_PATH, COLLECTIONS.TOOLS, t.firebaseId), { status: payload });
          }
        });
        window.App.UI.showToast('Status atualizado em lote. (Ignora emprestadas)', 'success');
        this.clearSelection();
        break;
      case 'category':
        if (
          !(await window.App.UI.confirmAction('Mover de categoria?', `Mover ${tools.length} ferramenta(s) para a categoria ${payload}?`, 'Mover'))
        ) {
          return;
        }
        tools.forEach((t) =>
          updateDoc(doc(db, DB_BASE_PATH, COLLECTIONS.TOOLS, t.firebaseId), { category: payload })
        );
        window.App.UI.showToast('Categoria atualizada em lote.', 'success');
        this.clearSelection();
        break;
      case 'label':
        tools.forEach((t) => {
          if (window.App.PDF && typeof window.App.PDF.generateQRLabel === 'function') {
            window.App.PDF.generateQRLabel(t.code, t.name);
          }
        });
        window.App.UI.showToast(`${tools.length} etiqueta(s) gerada(s).`, 'success');
        break;

      case 'export': {
        if (!window.XLSX) {
          window.App.UI.showToast('Carregando motor de planilhas...', 'info');
          window.Utils.loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js')
            .then(() => this.bulkAction('export'))
            .catch(() => window.App.UI.showToast('Erro ao carregar motor.', 'error'));
          return;
        }
        const data = tools.map((t) => ({
          Patrimônio: t.code,
          Descrição: t.name,
          Categoria: t.category,
          Status:
            t.status === 'available'
              ? 'Disponível'
              : t.status === 'borrowed'
                ? 'Emprestada'
                : 'Manutenção',
          Responsável: t.currentUser || '',
        }));
        const ws = window.XLSX.utils.json_to_sheet(data);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'Ferramentas');
        window.XLSX.writeFile(
          wb,
          `ferramentas_selecionadas_${new Date().toISOString().slice(0, 10)}.xlsx`
        );
        window.App.UI.showToast(`${tools.length} ferramenta(s) exportada(s).`, 'success');
        break;
      }

      case 'delete':
        if (
          await window.App.UI.confirmDanger('Excluir ferramentas?', `Tem certeza que deseja excluir ${tools.length} ferramenta(s)?`)
        ) {
          const promises = tools.map((t) =>
            deleteDoc(doc(db, DB_BASE_PATH, COLLECTIONS.TOOLS, t.firebaseId))
          );
          Promise.all(promises)
            .then(() => {
              window.App.UI.showToast(`${tools.length} ferramenta(s) excluída(s).`, 'success');
              this.selectedTools.clear();
              this.updateBulkBar();
            })
            .catch((err) => {
              window.Logger.error('Erro ao excluir ferramentas:', err);
              window.App.UI.showToast('Erro ao excluir algumas ferramentas.', 'error');
            });
        }
        break;
    }
  },

  quickStatusUpdate: function (id, newStatus) {
    if (!this.canManageTools()) {
      window.App.UI.showToast('Acesso restrito a administradores.', 'error');
      return;
    }
    const tool = window.App.Data.tools.find((t) => t.firebaseId === id);
    if (!tool) {
      return;
    }

    if (tool.status === 'borrowed' && newStatus !== 'borrowed') {
      window.App.UI.showToast('Não é possível alterar status de ferramenta emprestada.', 'warning');
      return;
    }

    updateDoc(doc(db, DB_BASE_PATH, COLLECTIONS.TOOLS, id), {
      status: newStatus,
    })
      .then(() => {
        window.App.UI.showToast('Status atualizado.', 'success');
      })
      .catch((err) => {
        window.Logger.error('Erro ao atualizar status:', err);
        window.App.UI.showToast('Erro ao atualizar status.', 'error');
      });
  },

  updateDashboardCharts: function (tools) {
    if (typeof window.Chart === 'undefined') {
      return;
    }

    if (typeof window.ChartDataLabels !== 'undefined') {
      window.Chart.register(window.ChartDataLabels);
    }

    const datalabelsConfig = {
      color: '#fff',
      font: { weight: 'bold', size: 12 },
      formatter: (value) => (value > 0 ? value : ''),
    };

    const statusCtx = document.getElementById('statusChart');
    if (statusCtx) {
      const avail = tools.filter((t) => t.status === 'available').length;
      const bor = tools.filter((t) => t.status === 'borrowed').length;
      const maint = tools.filter((t) => t.status === 'maintenance').length;

      const sChart = window.Chart.getChart(statusCtx);
      const sData = [avail, bor, maint];

      if (sChart) {
        sChart.data.datasets[0].data = sData;
        if (sChart.options.plugins && !sChart.options.plugins.datalabels) {
          sChart.options.plugins.datalabels = datalabelsConfig;
        }
        sChart.update();
      } else {
        new window.Chart(statusCtx, {
          type: 'doughnut',
          data: {
            labels: ['Disponível', 'Emprestada', 'Manutenção'],
            datasets: [
              { data: sData, backgroundColor: ['#10b981', '#f59e0b', '#f43f5e'], borderWidth: 0 },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            plugins: { legend: { display: false }, datalabels: datalabelsConfig },
          },
        });
      }
    }

    const catCtx = document.getElementById('categoryChart');
    if (catCtx) {
      const elCount = tools.filter((t) => t.category === 'Elétrica').length;
      const manCount = tools.filter((t) => t.category === 'Manual').length;
      const medCount = tools.filter((t) => t.category === 'Medição').length;

      const cChart = window.Chart.getChart(catCtx);
      const cData = [elCount, manCount, medCount];

      if (cChart) {
        cChart.data.datasets[0].data = cData;
        if (cChart.options.plugins && !cChart.options.plugins.datalabels) {
          cChart.options.plugins.datalabels = datalabelsConfig;
        }
        cChart.update();
      } else {
        new window.Chart(catCtx, {
          type: 'doughnut',
          data: {
            labels: ['Elétrica', 'Manual', 'Medição'],
            datasets: [
              { data: cData, backgroundColor: ['#3b82f6', '#10b981', '#f59e0b'], borderWidth: 0 },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            plugins: { legend: { display: false }, datalabels: datalabelsConfig },
          },
        });
      }
    }
  },

  openMaintenanceModal: function (toolId) {
    if (!this.canManageTools()) {
      window.App.UI.showToast(
        'Acesso restrito a administradores.',
        'error'
      );
      return;
    }

    const tool = window.App.Data.tools.find(
      (item) => item.firebaseId === toolId
    );

    if (!tool) {
      window.App.UI.showToast(
        'Ferramenta não encontrada.',
        'error'
      );
      return;
    }

    if (tool.status === 'borrowed') {
      window.App.UI.showToast(
        'Não é possível registrar manutenção de uma ferramenta emprestada.',
        'warning'
      );
      return;
    }

    const modal = document.getElementById(
      'tool-maintenance-modal'
    );
    const form = document.getElementById(
      'tool-maintenance-form'
    );
    const idInput = document.getElementById(
      'tool-maintenance-id'
    );
    const nameElement = document.getElementById(
      'tool-maintenance-name'
    );
    const performedInput = document.getElementById(
      'tool-maintenance-performed-at'
    );
    const nextInput = document.getElementById(
      'tool-maintenance-next'
    );

    if (
      !modal ||
      !form ||
      !idInput ||
      !nameElement ||
      !performedInput ||
      !nextInput
    ) {
      window.App.UI.showToast(
        'Não foi possível abrir o formulário de manutenção.',
        'error'
      );
      return;
    }

    const now = new Date();
    const localToday = new Date(
      now.getTime() - now.getTimezoneOffset() * 60000
    )
      .toISOString()
      .slice(0, 10);

    form.reset();
    idInput.value = tool.firebaseId;
    nameElement.textContent = `${tool.name} (${tool.code})`;
    performedInput.value = localToday;
    performedInput.max = localToday;
    nextInput.min = localToday;

    modal.showModal();
  },

  closeMaintenanceModal: function () {
    const modal = document.getElementById(
      'tool-maintenance-modal'
    );
    const form = document.getElementById(
      'tool-maintenance-form'
    );

    if (modal?.open) {
      modal.close();
    }

    form?.reset();
  },

  saveMaintenance: async function () {
    if (!this.canManageTools()) {
      window.App.UI.showToast(
        'Acesso restrito a administradores.',
        'error'
      );
      return;
    }

    const toolId = document
      .getElementById('tool-maintenance-id')
      ?.value.trim();
    const performedAt = document
      .getElementById('tool-maintenance-performed-at')
      ?.value.trim();
    const nextMaintenance = document
      .getElementById('tool-maintenance-next')
      ?.value.trim() || null;
    const notes = document
      .getElementById('tool-maintenance-notes')
      ?.value.trim() || '';
    const submitButton = document.getElementById(
      'tool-maintenance-submit'
    );

    if (!toolId || !performedAt || !submitButton) {
      window.App.UI.showToast(
        'Preencha os dados obrigatórios da manutenção.',
        'warning'
      );
      return;
    }

    const tool = window.App.Data.tools.find(
      (item) => item.firebaseId === toolId
    );

    if (!tool) {
      window.App.UI.showToast(
        'Ferramenta não encontrada.',
        'error'
      );
      return;
    }

    if (tool.status === 'borrowed') {
      window.App.UI.showToast(
        'Não é possível registrar manutenção de uma ferramenta emprestada.',
        'warning'
      );
      return;
    }

    const now = new Date();
    const localToday = new Date(
      now.getTime() - now.getTimezoneOffset() * 60000
    )
      .toISOString()
      .slice(0, 10);

    if (performedAt > localToday) {
      window.App.UI.showToast(
        'A data da manutenção não pode estar no futuro.',
        'warning'
      );
      return;
    }

    if (nextMaintenance && nextMaintenance < performedAt) {
      window.App.UI.showToast(
        'A próxima manutenção não pode ser anterior à manutenção realizada.',
        'warning'
      );
      return;
    }

    const originalText = submitButton.textContent;

    submitButton.disabled = true;
    submitButton.textContent = 'Registrando...';

    try {
      await requestToolMaintenance({
        toolId,
        performedAt,
        nextMaintenance,
        notes,
        device:
          window.App.Session?.currentDevice ||
          window.navigator.userAgent ||
          'Navegador'
      });

      window.App.UI.showToast(
        'Manutenção registrada com sucesso.',
        'success'
      );

      this.closeMaintenanceModal();
    } catch (error) {
      window.Logger.error(
        'Erro ao registrar manutenção:',
        error
      );

      window.App.UI.showToast(
        error?.message ||
          'Não foi possível registrar a manutenção.',
        'error'
      );
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  },

  showHistory: function (toolId) {
    const t = window.App.Data.tools.find((x) => x.firebaseId === toolId);
    if (!t) {
      return;
    }
    const modal = document.getElementById('tool-history-modal');
    const list = document.getElementById('tool-history-list');
    const title = document.getElementById('tool-history-name');
    if (!modal || !list || !title) {
      return;
    }

    title.textContent = `${t.name} (${t.code})`;
    const logs = (window.App.Data.allHistoryLogs || []).filter((log) => {
      const historyToolId = String(log.toolId || '').trim();

      return historyToolId ? historyToolId === t.firebaseId : log.toolCode === t.code;
    });
    logs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    if (logs.length === 0) {
      list.innerHTML =
        '<div class="text-center py-8 text-slate-500 font-medium">Nenhum histórico de movimentação para este ativo.</div>';
    } else {
      list.innerHTML = logs
        .map((log) => {
          const logType = String(log.type || '').toLowerCase();
          const isReturn = logType === 'in';
          const isLoan = logType === 'out';
          const isMaintenance = logType === 'maintenance';

          const accentClass = isReturn
            ? 'bg-emerald-500'
            : isLoan
              ? 'bg-amber-500'
              : isMaintenance
                ? 'bg-rose-500'
                : 'bg-slate-400';

          const typeClass = isReturn
            ? 'text-emerald-600 dark:text-emerald-400'
            : isLoan
              ? 'text-amber-600 dark:text-amber-400'
              : isMaintenance
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-600 dark:text-slate-300';

          const typeText = isReturn
            ? 'Devolvido por'
            : isLoan
              ? 'Retirado por'
              : isMaintenance
                ? 'Manutenção registrada por'
                : 'Evento registrado por';

          const safeUser = window.Utils.escapeHTML(
            log.user || 'Sistema'
          );
          const date = window.Utils.formatDate(log.date);

          const formatDateOnly = (value) => {
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
              String(value || '').trim()
            );

            return match
              ? `${match[3]}/${match[2]}/${match[1]}`
              : '';
          };

          const performedAt = formatDateOnly(log.performedAt);
          const nextMaintenance = formatDateOnly(
            log.nextMaintenance
          );
          const safeNotes = window.Utils.escapeHTML(
            log.notes || ''
          );

          const maintenanceDetails = isMaintenance
            ? `
              <div class="mt-3 space-y-1.5 rounded-xl border border-rose-100 bg-rose-50/70 p-3 text-xs dark:border-rose-900/50 dark:bg-rose-950/20">
                ${
                  performedAt
                    ? `<p class="font-semibold text-slate-600 dark:text-slate-300"><span class="text-slate-400">Realizada em:</span> ${performedAt}</p>`
                    : ''
                }
                ${
                  nextMaintenance
                    ? `<p class="font-semibold text-slate-600 dark:text-slate-300"><span class="text-slate-400">Próxima manutenção:</span> ${nextMaintenance}</p>`
                    : ''
                }
                ${
                  safeNotes
                    ? `<p class="whitespace-pre-wrap text-slate-600 dark:text-slate-300"><span class="font-semibold text-slate-400">Observações:</span> ${safeNotes}</p>`
                    : ''
                }
              </div>
            `
            : '';

          return `
          <div class="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700 flex items-start gap-4 shadow-sm relative overflow-hidden">
            <div class="absolute left-0 top-0 w-1 h-full ${accentClass}"></div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-bold text-slate-900 dark:text-white">
                <span class="${typeClass}">${typeText}</span>
                ${safeUser}
              </p>
              <p class="text-[10px] font-bold text-slate-400 mt-1">${date}</p>
              ${maintenanceDetails}
            </div>
          </div>
        `;
        })
        .join('');
    }
    modal.showModal();
  },
  closeHistoryModal: function () {
    const m = document.getElementById('tool-history-modal');
    if (m) {
      m.close();
    }
  },

  render: function () {
    const list = window.App.UI.domCache?.crudList || document.getElementById('crud-list');
    if (!list) {
      return;
    }
    if (!window.App.Data.toolsLoaded) {
      list.innerHTML = Array(6).fill(window.Utils.getSkeletonHTML()).join('');
      return;
    }

    const tools = window.App.Data.tools;

    const cA = tools.filter((t) => t.status === 'available').length;
    const cB = tools.filter((t) => t.status === 'borrowed').length;
    const cM = tools.filter((t) => t.status === 'maintenance').length;

    this.updateDashboardCharts(tools);

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = val;
      }
    };
    setText('inv-stat-total', tools.length);
    setText('inv-stat-available', cA);
    setText('inv-stat-borrowed', cB);
    setText('inv-stat-maintenance', cM);

    setText('filter-inv-available', cA);
    setText('filter-inv-borrowed', cB);
    setText('filter-inv-maintenance', cM);

    const cLate = tools.filter((t) => this.isLate(t)).length;
    const cMaintDue = tools.filter((t) => this.isMaintenanceDue(t)).length;
    setText('filter-count-late', cLate);
    setText('filter-count-maintenance-due', cMaintDue);

    const q = window.Utils.removeAccents(
      document.getElementById('tools-search')?.value || ''
    ).toLowerCase();
    const sort = document.getElementById('inventory-sort')?.value || 'name-asc';
    const categoryFilter = document.getElementById('inventory-category-filter')?.value || 'all';

    let filtered = tools;
    if (this.currentFilter !== 'all') {
      if (this.currentFilter === 'late') {
        filtered = filtered.filter((t) => this.isLate(t));
      } else if (this.currentFilter === 'maintenance-due') {
        filtered = filtered.filter((t) => this.isMaintenanceDue(t));
      } else {
        filtered = filtered.filter((t) => t.status === this.currentFilter);
      }
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter((t) => t.category === categoryFilter);
    }

    if (q) {
      filtered = filtered.filter(
        (t) =>
          window.Utils.removeAccents(String(t.name || ''))
            .toLowerCase()
            .includes(q) ||
          window.Utils.removeAccents(String(t.code || ''))
            .toLowerCase()
            .includes(q) ||
          window.Utils.removeAccents(String(t.category || ''))
            .toLowerCase()
            .includes(q)
      );
    }

    filtered.sort((a, b) => {
      switch (sort) {
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '', 'pt-BR');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '', 'pt-BR');
        case 'category':
          return (a.category || '').localeCompare(b.category || '', 'pt-BR');
        case 'status':
          return (a.status || '').localeCompare(b.status || '', 'pt-BR');
        case 'recent':
          return new Date(b.lastAction || 0) - new Date(a.lastAction || 0);
        case 'patrimony':
          return (a.code || '').localeCompare(b.code || '', 'pt-BR');
        default:
          return 0;
      }
    });

    const resultCountEl = document.getElementById('inventory-result-count');
    if (resultCountEl) {
      resultCountEl.textContent = `Mostrando ${Math.min(filtered.length, window.App.Data.crudLimit)} de ${filtered.length} ferramenta${filtered.length !== 1 ? 's' : ''}`;
    }

    if (!filtered.length) {
      const hasFilters =
        this.currentFilter !== 'all' ||
        q ||
        document.getElementById('inventory-category-filter')?.value !== 'all';

      list.innerHTML = `<div class="col-span-full text-center py-16 empty-state">
        <div class="w-24 h-24 mx-auto mb-6 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center">
          <svg class="w-12 h-12 text-slate-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
        </div>
        <h3 class="text-xl font-bold text-slate-700 dark:text-slate-300">${hasFilters ? 'Nenhuma ferramenta encontrada' : 'Nenhuma ferramenta cadastrada'}</h3>
        <p class="text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto">${hasFilters ? 'Tente ajustar os filtros de busca ou selecione outra categoria.' : 'Comece adicionando ferramentas ao inventário para gerenciar seu patrimônio.'}</p>
        ${!hasFilters && this.canManageTools() ? '<button onclick="App.CRUDTools.openModal()" class="mt-6 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-lg shadow-brand-600/30 transition-all active:scale-95 flex items-center gap-2 mx-auto"><svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5v14"/></svg> Nova Ferramenta</button>' : ''}
      </div>`;
      document.getElementById('crud-load-more')?.classList.add('hidden');
      return;
    }

    const showLoadMore = filtered.length > window.App.Data.crudLimit;
    document.getElementById('crud-load-more')?.classList.toggle('hidden', !showLoadMore);
    const paginated = filtered.slice(0, window.App.Data.crudLimit);

    list.innerHTML = this.renderGridView(paginated);
  },

  renderGridView: function (tools) {
    const canManage = this.canManageTools();
    return tools
      .map((t) => {
        const safeName = window.Utils.escapeHTML(t.name);
        const imgHtml = t.imageUrl
          ? `<img src="${window.Utils.escapeHTML(t.imageUrl)}" data-name="${safeName}" onclick="App.UI.showImagePreview(this.src, this.getAttribute('data-name'))" class="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0 cursor-zoom-in shadow-sm hover:scale-105 transition-transform" loading="lazy" decoding="async">`
          : '<div class="w-16 h-16 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0 shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 text-slate-300 dark:text-slate-600"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>';
        const dotColor =
          t.status === 'borrowed'
            ? 'bg-amber-500'
            : t.status === 'maintenance'
              ? 'bg-rose-500'
              : 'bg-emerald-500';
        const statusBorder =
          t.status === 'borrowed'
            ? 'border-l-amber-500'
            : t.status === 'maintenance'
              ? 'border-l-rose-500'
              : 'border-l-emerald-500';
        const isLate = this.isLate(t);
        const isMaintDue = this.isMaintenanceDue(t);
        const isMaintWarn = this.isMaintenanceWarning(t);
        let customBadges = '';
        if (isLate) {
          customBadges += `<span class="px-2 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold rounded animate-pulse border border-rose-200 shadow-sm whitespace-nowrap">⚠️ Atrasada (${this.getDaysLate(t)}d)</span>`;
        }
        if (isMaintDue) {
          customBadges +=
            '<span class="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded animate-pulse border border-orange-200 shadow-sm whitespace-nowrap">⚠️ Rev. Vencida</span>';
        } else if (isMaintWarn) {
          customBadges +=
            '<span class="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-[10px] font-bold rounded border border-yellow-200 shadow-sm whitespace-nowrap">⏳ Rev. Próxima</span>';
        }

        const overrideBorder = isLate
          ? 'border-2 border-rose-500 shadow-rose-500/20'
          : isMaintDue
            ? 'border-2 border-orange-500 shadow-orange-500/20'
            : '';
        const finalBorderClass =
          overrideBorder ||
          `border border-slate-200 dark:border-slate-800 border-l-4 ${statusBorder}`;

        const quickActionBtn = canManage
          ? t.status === 'available'
            ? '<button aria-label="Emprestar" onclick="App.UI.switchTab(\'scanner\'); setTimeout(() => App.Scanner.setMode(\'cam\'), 100);" class="flex-1 py-2 bg-brand-50 dark:bg-brand-900/30 hover:bg-brand-100 dark:hover:bg-brand-900/50 text-brand-700 dark:text-brand-400 rounded-xl border border-brand-200 dark:border-brand-800 transition-colors flex items-center justify-center shadow-sm" title="Emprestar"><svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10h14l-4-4"/><path d="M17 14H3l4 4"/></svg></button>'
            : t.status === 'borrowed'
              ? '<button aria-label="Devolver" onclick="App.UI.switchTab(\'scanner\'); setTimeout(() => App.Scanner.setMode(\'cam\'), 100);" class="flex-1 py-2 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-800 transition-colors flex items-center justify-center shadow-sm" title="Devolver"><svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg></button>'
              : ''
          : '';
        const maintenanceActionBtn =
          canManage && t.status !== 'borrowed'
            ? `<button aria-label="Registrar manutenção" onclick="App.CRUDTools.openMaintenanceModal('${t.firebaseId}')" class="flex-1 py-2 bg-rose-50 dark:bg-rose-900/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-400 rounded-xl border border-rose-200 dark:border-rose-800 transition-colors flex items-center justify-center shadow-sm" title="Registrar Manutenção"><svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></button>`
            : '';

        const statusControl = canManage
          ? `<select onchange="App.CRUDTools.quickStatusUpdate('${t.firebaseId}', this.value)" class="text-xs font-bold px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/20 cursor-pointer ${t.status === 'borrowed' ? 'text-amber-600' : t.status === 'maintenance' ? 'text-rose-600' : 'text-emerald-600'}"><option value="available" ${t.status === 'available' ? 'selected' : ''}>Disponível</option><option value="borrowed" ${t.status === 'borrowed' ? 'selected' : ''}>Emprestada</option><option value="maintenance" ${t.status === 'maintenance' ? 'selected' : ''}>Manutenção</option></select>`
          : `<span class="text-[11px] font-bold ${t.status === 'borrowed' ? 'text-amber-600' : t.status === 'maintenance' ? 'text-rose-600' : 'text-emerald-600'}">${t.status === 'borrowed' ? 'Emprestada' : t.status === 'maintenance' ? 'Manutenção' : 'Disponível'}</span>`;
        return `<div class="tool-card bg-white dark:bg-slate-900 rounded-2xl shadow-sm ${finalBorderClass} p-5 flex flex-col gap-4 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group"><div class="flex items-start gap-4 pl-2"><div class="relative">${imgHtml}<span class="absolute -top-1 -right-1 w-3 h-3 rounded-full ${dotColor} border-2 border-white dark:border-slate-900 shadow-sm"></span></div><div class="flex-1 min-w-0"><h3 class="font-extrabold text-slate-900 dark:text-white text-sm sm:text-base leading-tight truncate" title="${safeName}">${safeName}</h3><div class="flex items-center gap-1.5 mt-1.5 flex-wrap"><span class="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-[10px] font-bold rounded">${window.Utils.escapeHTML(t.category)}</span><p class="text-[10px] font-bold text-slate-500 truncate">Pat: ${window.Utils.escapeHTML(t.code)}</p>${customBadges}</div></div></div><div class="border-t border-slate-100 dark:border-slate-800 ml-2"></div><div class="flex flex-col gap-2 pl-2"><div class="flex justify-between items-center"><span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status Atual</span>${statusControl}</div><div class="flex justify-between items-center mt-0.5"><span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest" title="Última atualização do status"><svg class="w-3 h-3 inline-block mr-0.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Última Ação</span><span class="text-[10px] font-bold text-slate-600 dark:text-slate-300">${t.lastAction ? window.Utils.formatDate(t.lastAction) : '-'}</span></div>${t.currentUser ? `<div class="flex justify-between items-center"><span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Responsável</span><span class="text-[10px] font-bold text-brand-600 dark:text-brand-400 truncate max-w-[120px]">${window.Utils.escapeHTML(t.currentUser)}</span></div>` : ''}</div><div class="flex gap-1.5 mt-2">${quickActionBtn}${maintenanceActionBtn}<button aria-label="Editar" onclick="App.CRUDTools.openModal('${t.firebaseId}')" class="${canManage ? '' : 'hidden'} flex-1 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center shadow-sm" title="Editar Ferramenta"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button><button aria-label="Histórico" onclick="App.CRUDTools.showHistory('${t.firebaseId}')" class="${canManage ? '' : 'hidden'} flex-1 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center shadow-sm" title="Ver Histórico"><svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg></button></div></div>`;
      })
      .join(' ');
  },

  openModal: function (id = null) {
    if (!this.canManageTools()) {
      window.App.UI.showToast('Acesso restrito a administradores.', 'error');
      return;
    }
    this.clearManualPreview();

    const m = document.getElementById('crud-modal');
    if (m) {
      m.showModal();
    }
    const pre = document.getElementById('crud-image-preview'),
      icon = document.getElementById('image-placeholder-icon'),
      manualButton = document.getElementById('btn-view-manual');
    document.getElementById('crud-image').value = '';
    if (pre) {
      pre.classList.add('hidden');
      pre.src = '';
    }

    document.getElementById('crud-condition').value = 'Bom';
    document.getElementById('crud-next-maintenance').value = '';
    document.getElementById('crud-notes').value = '';
    document.getElementById('crud-manual').value = '';
    document.getElementById('manual-file-name').textContent = 'Nenhum arquivo';
    manualButton.dataset.manualUrl = '';
    manualButton.dataset.savedManualUrl = '';
    manualButton.dataset.savedManualName = '';
    manualButton.classList.add('hidden');

    if (icon) {
      icon.classList.remove('hidden');
    }
    if (id) {
      const t = window.App.Data.tools.find((x) => x.firebaseId === id);
      document.getElementById('modal-title').textContent = 'Editar Ferramenta';
      document.getElementById('crud-id').value = t.firebaseId;
      document.getElementById('crud-code').value = t.code;
      document.getElementById('crud-code').disabled = true;
      document.getElementById('crud-name').value = t.name;
      document.getElementById('crud-category').value = t.category;
      document.getElementById('crud-status-container').classList.remove('hidden');
      document.getElementById('crud-status').value =
        t.status === 'borrowed' ? 'available' : t.status;
      if (t.imageUrl && pre && icon) {
        pre.src = t.imageUrl;
        pre.classList.remove('hidden');
        icon.classList.add('hidden');
      }
      if (t.condition) {
        document.getElementById('crud-condition').value = t.condition;
      }
      if (t.nextMaintenance) {
        document.getElementById('crud-next-maintenance').value = t.nextMaintenance;
      }
      if (t.notes) {
        document.getElementById('crud-notes').value = t.notes;
      }
      if (t.manualUrl) {
        manualButton.dataset.manualUrl = t.manualUrl;
        manualButton.dataset.savedManualUrl = t.manualUrl;
        manualButton.dataset.savedManualName = t.manualName || '';
        manualButton.classList.remove('hidden');
        document.getElementById('manual-file-name').textContent = t.manualName || 'PDF anexado';
      }
    } else {
      document.getElementById('modal-title').textContent = 'Nova Ferramenta';
      document.getElementById('crud-id').value = '';
      document.getElementById('crud-code').value = '';
      document.getElementById('crud-code').disabled = false;
      document.getElementById('crud-name').value = '';
      document.getElementById('crud-status-container').classList.add('hidden');
    }
  },
  closeModal: function () {
    this.clearManualPreview();

    const m = document.getElementById('crud-modal');
    if (m) {
      m.close();
    }
  },
  saveTool: async function () {
    if (!this.canManageTools()) {
      window.App.UI.showToast('Acesso restrito a administradores.', 'error');
      return;
    }
    const id = document.getElementById('crud-id').value,
      code = document.getElementById('crud-code').value.trim(),
      name = document.getElementById('crud-name').value.trim(),
      cat = document.getElementById('crud-category').value,
      file = document.getElementById('crud-image'),
      cond = document.getElementById('crud-condition').value,
      nextMaint = document.getElementById('crud-next-maintenance').value,
      notes = document.getElementById('crud-notes').value.trim(),
      manualFile = document.getElementById('crud-manual').files[0];

    if (!code || !name) {
      return window.App.UI.showToast(
        "Os campos 'Patrimonio' e 'Descricao' são obrigatórios.",
        'warning'
      );
    }
    if (
      window.App.Data.tools.some(
        (t) => t.firebaseId !== id && String(t.code).toLowerCase() === String(code).toLowerCase()
      )
    ) {
      return window.App.UI.showToast('Ref/Patrimonio já cadastrado.', 'warning');
    }
    const btn = document.getElementById('btn-save-tool');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 mr-2 animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Salvando...';
    try {
      let imgUrl = null;
      const tool = id ? window.App.Data.tools.find((t) => t.firebaseId === id) : null;
      let manualUrl = tool?.manualUrl || null;
      let manualName = tool?.manualName || null;

      if (tool && tool.imageUrl) {
        imgUrl = tool.imageUrl;
      }
      if (file && file.files.length > 0) {
        imgUrl = await window.Utils.compressImageToBase64(file.files[0]);
      }

      if (manualFile) {
        manualName = manualFile.name;
        manualUrl = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result);
          reader.onerror = rej;
          reader.readAsDataURL(manualFile);
        });
      }

      if (id) {
        const u = {
          name,
          category: cat,
          condition: cond,
          nextMaintenance: nextMaint || null,
          notes: notes,
          manualUrl: manualUrl,
          manualName: manualName,
        };
        if (tool && tool.status !== 'borrowed') {
          u.status = document.getElementById('crud-status').value;
        }
        if (imgUrl) {
          u.imageUrl = imgUrl;
        }
        await window.Utils.withTimeout(updateDoc(doc(db, DB_BASE_PATH, COLLECTIONS.TOOLS, id), u));
        window.App.UI.showToast('Atualizada com sucesso.', 'success');
      } else {
        await window.Utils.withTimeout(
          setDoc(doc(db, DB_BASE_PATH, COLLECTIONS.TOOLS, code), {
            code,
            name,
            category: cat,
            status: 'available',
            currentUser: null,
            lastAction: null,
            imageUrl: imgUrl,
            condition: cond,
            nextMaintenance: nextMaint || null,
            notes: notes,
            manualUrl: manualUrl,
            manualName: manualName,
          })
        );
        window.App.UI.showToast('Registrada com sucesso.', 'success');
      }
      this.closeModal();
    } catch (err) {
      window.Logger.error('Falha na transação de dados.', err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  },
  deleteTool: async function (id) {
    if (!this.canManageTools()) {
      window.App.UI.showToast('Acesso restrito a administradores.', 'error');
      return;
    }
    if (
      await window.App.UI.confirmDanger('Excluir ferramenta?', 'Excluir definitivamente esta ferramenta?')
    ) {
      try {
        await deleteDoc(doc(db, DB_BASE_PATH, COLLECTIONS.TOOLS, id));
        window.App.UI.showToast('Excluída com sucesso.', 'success');
      } catch (e) {
        window.Logger.error('Erro ao excluir.', e);
      }
    }
  },
  importFile: async function (e) {
    if (!this.canManageTools()) {
      window.App.UI.showToast('Acesso restrito a administradores.', 'error');
      return;
    }
    if (!e || !e.target || !e.target.files) {
      return;
    }
    if (!window.XLSX) {
      window.App.UI.showToast('Carregando motor de planilhas...', 'info');
      try {
        await window.Utils.loadScript(
          'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
        );
      } catch {
        window.App.UI.showToast('Erro ao carregar o motor.', 'error');
        e.target.value = '';
        return;
      }
    }
    const f = e.target.files[0];
    if (!f) {
      return;
    }
    const r = new FileReader();
    r.onload = async (ev) => {
      try {
        const wb = window.XLSX.read(new Uint8Array(ev.target.result), {
          type: 'array',
        });
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
          header: 1,
        });
        if (rows.length < 2) {
          return window.App.UI.showToast('Arquivo vazio ou inválido.', 'error');
        }
        window.App.UI.showToast('Importando ferramentas... Aguarde.', 'info');
        let c = 0,
          dup = 0;
        const eC = new Set(window.App.Data.tools.map((t) => String(t.code).toLowerCase()));
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          if (!cols || cols.length === 0) {
            continue;
          }
          const code = cols[0] !== null && cols[0] !== undefined ? String(cols[0]).trim() : '';
          let name = cols[1] !== null && cols[1] !== undefined ? String(cols[1]).trim() : '';
          const cat = cols[2] !== null && cols[2] !== undefined ? String(cols[2]).trim() : 'Outros';
          let status =
            cols[3] !== null && cols[3] !== undefined ? String(cols[3]).trim() : 'available';
          const currentUser =
            cols[4] !== null && cols[4] !== undefined ? String(cols[4]).trim() : null;
          if (name.startsWith('"') && name.endsWith('"')) {
            name = name.slice(1, -1);
          }
          if (status === 'Disponível') {
            status = 'available';
          } else if (status === 'Emprestada' || status === 'borrowed') {
            status = 'borrowed';
          } else if (status === 'Manutenção' || status === 'maintenance') {
            status = 'maintenance';
          } else {
            status = 'available';
          }
          if (code && name) {
            const lC = code.toLowerCase();
            if (eC.has(lC)) {
              dup++;
              continue;
            }
            eC.add(lC);
            try {
              await setDoc(doc(db, DB_BASE_PATH, COLLECTIONS.TOOLS, code), {
                code,
                name,
                category: cat,
                status,
                currentUser: status === 'borrowed' ? currentUser : null,
                lastAction: new Date().toISOString(),
                imageUrl: null,
              });
              c++;
            } catch (err) {
              window.Logger.warn(`Erro ao importar ferramenta ${code}:`, err?.message);
            }
          }
        }
        window.App.UI.showToast(
          `${c} ferramentas importadas. ${dup > 0 ? `(${dup} ignoradas)` : ''}`,
          'success'
        );
      } catch {
        window.App.UI.showToast('Falha ao ler arquivo.', 'error');
      } finally {
        e.target.value = '';
      }
    };
    r.readAsArrayBuffer(f);
  },
};
