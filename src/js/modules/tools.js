import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { auth, db, DB_BASE_PATH, COLLECTIONS } from '../app.js';
import {
  Alert,
  Badge,
  Button,
  Dropdown,
  EmptyState,
  IconButton,
  Search,
  Select,
  SkeletonCard,
  StatusBadge,
  esc,
  icon
} from '../components/index.js';
import { BREAKPOINTS } from '../config/breakpoints.js';

// Status (com contagem) da barra de filtros. Os valores são os mesmos de sempre.
const STATUS_FILTERS = Object.freeze([
  { value: 'all', label: 'Todas' },
  { value: 'available', label: 'Disponíveis' },
  { value: 'borrowed', label: 'Emprestadas' },
  { value: 'maintenance', label: 'Manutenção' },
  { value: 'late', label: 'Em atraso', hint: 'Ferramentas emprestadas há mais de 7 dias.' },
  {
    value: 'maintenance-due',
    label: 'Revisão vencida',
    hint: 'Ferramentas com calibração ou revisão vencida.'
  }
]);

const SORT_OPTIONS = Object.freeze([
  { value: 'name-asc', label: 'Nome A-Z' },
  { value: 'name-desc', label: 'Nome Z-A' },
  { value: 'category', label: 'Categoria' },
  { value: 'status', label: 'Status' },
  { value: 'recent', label: 'Mais recentes' },
  { value: 'patrimony', label: 'Patrimônio' }
]);

// A lista vira tabela a partir do notebook (rail + conteúdo largo); abaixo disso são cartões.
const TABLE_QUERY = `(min-width: ${BREAKPOINTS.notebook}px)`;

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
  _mounted: false,
  _menus: [],
  _renderPending: false,

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
    this._syncChips();
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
        // 'borrowed' nunca é um destino aceitável em lote: mesma regra do ajuste individual
        // (quickStatusUpdate) — só entra em empréstimo pelo fluxo oficial do Scanner.
        if (!this.QUICK_STATUS_TARGETS.includes(payload)) {
          window.App.UI.showToast('Status inválido para alteração em lote.', 'error');
          return;
        }
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
        window.App.UI.showToast('Status atualizado em lote. (Ignora as já emprestadas)', 'success');
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

      case 'delete': {
        // Mesma regra do delete individual: ferramenta emprestada precisa ser devolvida
        // oficialmente antes de excluir. Filtra em vez de abortar a seleção inteira.
        const deletable = tools.filter((t) => t.status !== 'borrowed');
        const skippedBorrowed = tools.length - deletable.length;
        if (deletable.length === 0) {
          window.App.UI.showToast(
            'Nenhuma ferramenta selecionada pode ser excluída (todas emprestadas).',
            'warning'
          );
          return;
        }
        if (
          !(await window.App.UI.confirmDanger('Excluir ferramentas?', `Tem certeza que deseja excluir ${deletable.length} ferramenta(s)?`))
        ) {
          return;
        }
        const promises = deletable.map((t) =>
          deleteDoc(doc(db, DB_BASE_PATH, COLLECTIONS.TOOLS, t.firebaseId))
        );
        Promise.all(promises)
          .then(() => {
            const suffix = skippedBorrowed > 0 ? ` (${skippedBorrowed} emprestada(s) ignorada(s))` : '';
            window.App.UI.showToast(`${deletable.length} ferramenta(s) excluída(s).${suffix}`, 'success');
            this.selectedTools.clear();
            this.updateBulkBar();
          })
          .catch((err) => {
            window.Logger.error('Erro ao excluir ferramentas:', err);
            window.App.UI.showToast('Erro ao excluir algumas ferramentas.', 'error');
          });
        break;
      }
    }
  },

  // Destinos legítimos de ajuste manual de status. 'borrowed' nunca é um destino válido aqui:
  // entrar em empréstimo exige o fluxo oficial (Scanner -> Movement API), que valida ferramenta e
  // colaborador no servidor e cria o movimento correspondente. Checagem programática, não só de UI.
  QUICK_STATUS_TARGETS: ['available', 'maintenance'],

  quickStatusUpdate: function (id, newStatus) {
    if (!this.canManageTools()) {
      window.App.UI.showToast('Acesso restrito a administradores.', 'error');
      return;
    }
    if (!this.QUICK_STATUS_TARGETS.includes(newStatus)) {
      window.App.UI.showToast('Status inválido para ajuste manual.', 'error');
      return;
    }
    const tool = window.App.Data.tools.find((t) => t.firebaseId === id);
    if (!tool) {
      return;
    }

    if (tool.status === 'borrowed') {
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

  // ---------------------------------------------------------------------------------------------
  // TELA FERRAMENTAS (Gate 1-F2): controles, lista e ações.
  // ---------------------------------------------------------------------------------------------

  // Filtros e busca/ordenação são montados uma única vez (com os componentes do design system) e
  // depois só atualizados: assim o foco do usuário não se perde a cada renderização.
  mountControls: function () {
    const filters = document.getElementById('tools-filters');
    const toolbar = document.getElementById('tools-toolbar');

    if (this._mounted || !filters || !toolbar) {
      return;
    }

    this._mounted = true;

    filters.innerHTML = STATUS_FILTERS.map((filter) => {
      const hint = filter.hint
        ? `<span id="tools-hint-${filter.value}" class="ui-sr-only">${esc(filter.hint)}</span>`
        : '';

      return `<button type="button" class="ui-btn ui-btn--secondary ui-btn--sm tools-chip" data-tools-filter="${filter.value}" aria-pressed="${filter.value === this.currentFilter}"${
        filter.hint ? ` aria-describedby="tools-hint-${filter.value}"` : ''
      }><span class="ui-btn__label">${esc(filter.label)}</span><span class="tools-chip__count" data-tools-count="${filter.value}">0</span></button>${hint}`;
    }).join('');

    toolbar.innerHTML =
      Search({
        id: 'tools-search',
        label: 'Buscar por nome, patrimônio ou categoria',
        placeholder: 'Nome, patrimônio ou categoria',
        className: 'tools-toolbar__search'
      }) +
      Select({
        id: 'inventory-category-filter',
        label: 'Filtrar por categoria',
        hideLabel: true,
        className: 'tools-toolbar__select',
        options: [{ value: 'all', label: 'Todas as categorias' }]
      }) +
      Select({
        id: 'inventory-sort',
        label: 'Ordenar por',
        hideLabel: true,
        className: 'tools-toolbar__select',
        options: SORT_OPTIONS
      });

    this._bindEvents();
  },

  // Listeners da tela (delegação): nada de onclick inline nos itens renderizados.
  _bindEvents: function () {
    const screen = document.getElementById('tab-management');

    screen?.addEventListener('click', (event) => this._onClick(event));
    document
      .getElementById('inventory-category-filter')
      ?.addEventListener('change', () => this.render());
    document.getElementById('inventory-sort')?.addEventListener('change', () => this.render());
    document
      .getElementById('crud-import-input-tool')
      ?.addEventListener('change', (event) => this.importFile(event));

    // A lista troca de forma (tabela x cartões) na mudança do breakpoint; os dados são os mesmos.
    const wide = window.matchMedia(TABLE_QUERY);

    wide.addEventListener('change', () => {
      if (window.App?.UI?.activeTab === 'management') {
        this.render();
      }
    });
  },

  _onClick: function (event) {
    const filter = event.target.closest('[data-tools-filter]');

    if (filter) {
      this.setQuickFilter(filter.dataset.toolsFilter);
      return;
    }

    const trigger = event.target.closest('[data-tools-action]');

    if (!trigger || trigger.disabled) {
      return;
    }

    const { toolsAction: action, toolId } = trigger.dataset;

    // Item de menu: devolve o foco ao gatilho da linha antes da ação. Se a ação abrir um modal, o
    // navegador devolve o foco a esse gatilho ao fechá-lo (o item do menu já não existe visível).
    if (trigger.getAttribute('role') === 'menuitem') {
      this._focusMenuTrigger(toolId);
    }

    switch (action) {
      case 'export':
        this.quickExport();
        break;
      case 'import':
        document.getElementById('crud-import-input-tool')?.click();
        break;
      case 'new':
        this.openModal();
        break;
      case 'clear-filters':
        this.clearFilters();
        break;
      case 'load-more':
        window.App.Data.loadMoreCrud();
        break;
      case 'scanner':
        window.App.UI.switchTab('scanner');
        setTimeout(() => window.App.Scanner.setMode('cam'), 100);
        break;
      case 'edit':
        this.openModal(toolId);
        break;
      case 'maintenance':
        this.openMaintenanceModal(toolId);
        break;
      case 'history':
        this.showHistory(toolId);
        break;
      case 'status':
        this.quickStatusUpdate(toolId, trigger.dataset.nextStatus);
        break;
      case 'preview':
        window.App.UI.showImagePreview(
          trigger.querySelector('img')?.src || '',
          trigger.dataset.name
        );
        break;
      default:
    }
  },

  clearFilters: function () {
    const search = document.getElementById('tools-search');
    const category = document.getElementById('inventory-category-filter');

    if (search) {
      search.value = '';
    }

    if (category) {
      category.value = 'all';
    }

    this.setQuickFilter('all');
    // O botão "Limpar filtros" some ao limpar: o foco vai para a busca, não se perde.
    search?.focus();
  },

  // Categorias vêm dos dados carregados (a lista só é conhecida depois do carregamento).
  _syncCategories: function (tools) {
    const select = document.getElementById('inventory-category-filter');

    if (!select) {
      return;
    }

    const categories = [...new Set(tools.map((t) => t.category).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'pt-BR')
    );
    const key = categories.join('\u0000');

    if (select.dataset.categories === key) {
      return;
    }

    const previous = select.value;

    select.innerHTML =
      '<option value="all">Todas as categorias</option>' +
      categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    select.value = categories.includes(previous) ? previous : 'all';
    select.dataset.categories = key;
  },

  _isTableLayout: function () {
    return window.matchMedia(TABLE_QUERY).matches;
  },

  _disposeMenus: function () {
    this._menus.forEach((menu) => menu.dispose());
    this._menus = [];
  },

  _mountMenus: function (list) {
    this._menus = [...list.querySelectorAll('[data-dropdown]')].map(
      (root) =>
        new Dropdown({
          trigger: root.querySelector('[data-tools-menu-trigger]'),
          panel: root.querySelector('.ui-menu'),
          onOpen: () => this._setBackgroundInert(root.closest('[data-tool-id]')),
          onClose: ({ restoreFocus } = {}) => {
            this._setBackgroundInert(null);
            this._flushPendingRender({
              restoreFocus,
              toolId: root.closest('[data-tool-id]')?.dataset.toolId
            });
          }
        })
    );
  },

  // Com um menu de linha aberto, o resto da tela fica inerte (sem clique, sem foco): o menu flutuante
  // cobre parte de botões de outras linhas e um clique fora dele, em uma faixa ainda visível, fecharia o
  // menu E acionaria o botão de baixo (ex.: Emprestar levava ao Scanner). Sem linha ativa, tudo volta.
  _setBackgroundInert: function (activeRow) {
    document
      .querySelectorAll(
        '#tools-screen .tools-header, #tools-filters, #tools-toolbar, .tools-meta, #crud-load-more, #crud-list tr[data-tool-id], #crud-list li[data-tool-id]'
      )
      .forEach((element) => {
        element.inert = Boolean(activeRow) && element !== activeRow;
      });
  },

  // Uma atualização de dados durante um menu aberto esperaria o menu fechar: re-renderizar agora
  // faria o menu sumir debaixo do teclado/leitor de tela.
  _flushPendingRender: function ({ restoreFocus = false, toolId } = {}) {
    if (this._renderPending && !this._menus.some((menu) => menu.isOpen())) {
      this._renderPending = false;
      this.render();

      // O gatilho antigo saiu do DOM com a renderização: o foco volta ao gatilho novo da mesma linha.
      if (restoreFocus) {
        this._focusMenuTrigger(toolId);
      }
    }
  },

  _focusMenuTrigger: function (toolId) {
    const row = [...document.querySelectorAll('#crud-list tr[data-tool-id], #crud-list li[data-tool-id]')].find(
      (element) => element.dataset.toolId === toolId
    );

    row?.querySelector('[data-tools-menu-trigger]')?.focus({ preventScroll: true });
  },

  _setMeta: function ({ count, filters = 0 }) {
    const countEl = document.getElementById('inventory-result-count');
    const filtersEl = document.getElementById('tools-active-filters');
    const clearButton = document.getElementById('tools-clear-filters');

    if (countEl) {
      countEl.textContent = count;
    }

    if (filtersEl) {
      filtersEl.textContent = filters
        ? `${filters} filtro${filters !== 1 ? 's' : ''} ativo${filters !== 1 ? 's' : ''}`
        : '';
    }

    if (clearButton) {
      clearButton.hidden = filters === 0;
    }
  },

  render: function () {
    const list = window.App.UI.domCache?.crudList || document.getElementById('crud-list');
    if (!list) {
      return;
    }

    if (this._menus.some((menu) => menu.isOpen())) {
      this._renderPending = true;
      return;
    }

    this._disposeMenus();

    const loadMore = document.getElementById('crud-load-more');
    const feedback = document.getElementById('tools-feedback');

    if (feedback) {
      feedback.innerHTML = '';
    }

    if (!window.App.Data.toolsLoaded) {
      list.setAttribute('aria-busy', 'true');
      list.innerHTML = `<div class="tools-skeleton">${Array(6).fill(SkeletonCard()).join('')}</div>`;
      this._setMeta({ count: 'Carregando ferramentas...' });
      if (loadMore) {
        loadMore.hidden = true;
      }
      return;
    }

    list.removeAttribute('aria-busy');

    // Falha ao carregar: aviso persistente e distinto de "nenhuma ferramenta cadastrada".
    if (window.App.Data.toolsError) {
      if (feedback) {
        feedback.innerHTML = Alert({
          tone: 'danger',
          title: 'Não foi possível carregar as ferramentas',
          message:
            'Verifique a conexão e recarregue a página. Se o problema continuar, procure um administrador.'
        });
      }
      list.innerHTML = '';
      this._setMeta({ count: '' });
      if (loadMore) {
        loadMore.hidden = true;
      }
      return;
    }

    const tools = window.App.Data.tools;

    const cA = tools.filter((t) => t.status === 'available').length;
    const cB = tools.filter((t) => t.status === 'borrowed').length;
    const cM = tools.filter((t) => t.status === 'maintenance').length;

    this.updateDashboardCharts(tools);

    const cLate = tools.filter((t) => this.isLate(t)).length;
    const cMaintDue = tools.filter((t) => this.isMaintenanceDue(t)).length;

    const counts = {
      all: tools.length,
      available: cA,
      borrowed: cB,
      maintenance: cM,
      late: cLate,
      'maintenance-due': cMaintDue
    };

    document.querySelectorAll('[data-tools-count]').forEach((el) => {
      el.textContent = counts[el.dataset.toolsCount] ?? 0;
    });
    this._syncChips();
    this._syncCategories(tools);

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

    const activeFilters =
      (this.currentFilter !== 'all' ? 1 : 0) + (categoryFilter !== 'all' ? 1 : 0) + (q ? 1 : 0);

    this._setMeta({
      count: `Mostrando ${Math.min(filtered.length, window.App.Data.crudLimit)} de ${filtered.length} ferramenta${filtered.length !== 1 ? 's' : ''}`,
      filters: activeFilters
    });

    if (!filtered.length) {
      list.innerHTML = this._emptyStateHtml(tools.length > 0);
      if (loadMore) {
        loadMore.hidden = true;
      }
      return;
    }

    if (loadMore) {
      loadMore.hidden = filtered.length <= window.App.Data.crudLimit;
    }
    const paginated = filtered.slice(0, window.App.Data.crudLimit);

    list.innerHTML = this._isTableLayout()
      ? this.renderTableView(paginated)
      : this.renderCardsView(paginated);
    this._mountMenus(list);
  },

  // EMPTY: o inventário está vazio. NO_RESULTS: há ferramentas, mas nenhuma atende à busca/filtros.
  _emptyStateHtml: function (hasTools) {
    if (hasTools) {
      const action = Button({
        label: 'Limpar filtros',
        variant: 'secondary',
        attributes: { 'data-tools-action': 'clear-filters' }
      });

      return EmptyState({
        title: 'Nenhuma ferramenta encontrada',
        description: 'Nenhuma ferramenta corresponde à busca e aos filtros atuais.',
        icon: 'icon-search',
        action
      });
    }

    const action = this.canManageTools()
      ? Button({
        label: 'Nova ferramenta',
        variant: 'secondary',
        icon: 'icon-plus',
        attributes: { 'data-tools-action': 'new' }
      })
      : '';

    return EmptyState({
      title: 'Nenhuma ferramenta cadastrada',
      description: 'Comece adicionando ferramentas ao inventário para gerenciar seu patrimônio.',
      icon: 'icon-inventory',
      action
    });
  },

  _syncChips: function () {
    document.querySelectorAll('[data-tools-filter]').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.toolsFilter === this.currentFilter));
    });
  },

  // Miniatura: clicável (amplia) quando há imagem; ícone decorativo quando não há.
  _thumb: function (t) {
    const name = esc(t.name);

    return t.imageUrl
      ? `<button type="button" class="tools-thumb" data-tools-action="preview" data-name="${name}" aria-label="Ampliar imagem de ${name}"><img src="${esc(t.imageUrl)}" alt="" loading="lazy" decoding="async"></button>`
      : `<span class="tools-thumb" aria-hidden="true">${icon('icon-inventory', 'ui-icon')}</span>`;
  },

  // Status (StatusBadge, sempre com texto) + alertas de prazo, sempre em palavras.
  _statusCell: function (t) {
    let flags = '';

    if (this.isLate(t)) {
      flags += Badge({ label: `Atrasada (${this.getDaysLate(t)}d)`, tone: 'danger' });
    }

    if (this.isMaintenanceDue(t)) {
      flags += Badge({ label: 'Revisão vencida', tone: 'warning' });
    } else if (this.isMaintenanceWarning(t)) {
      flags += Badge({ label: 'Revisão próxima', tone: 'info' });
    }

    return `<div class="tools-status">${StatusBadge(t.status)}${flags}</div>`;
  },

  // Ação principal (Emprestar/Devolver, atalho para o Scanner) + menu com as demais. Só para quem
  // pode gerenciar ferramentas; cada ação continua validando a permissão ao executar.
  _actionsCell: function (t) {
    if (!this.canManageTools()) {
      return '';
    }

    const id = esc(t.firebaseId);
    const borrowed = t.status === 'borrowed';
    const item = (action, label, extra = '') =>
      `<button type="button" role="menuitem" class="ui-menu__item" data-tools-action="${action}" data-tool-id="${id}"${extra}>${esc(label)}</button>`;

    let primary = '';

    if (t.status === 'available' || borrowed) {
      const label = borrowed ? 'Devolver' : 'Emprestar';

      primary = Button({
        label,
        size: 'sm',
        variant: 'secondary',
        attributes: { 'data-tools-action': 'scanner', 'aria-label': `${label} ${t.name}` }
      });
    }

    let items = item('edit', 'Editar');

    if (!borrowed) {
      items += item('maintenance', 'Registrar manutenção');
    }

    items += item('history', 'Histórico');

    if (!borrowed) {
      // 'borrowed' não é um destino de ajuste rápido: entrar em empréstimo exige o fluxo oficial
      // (Scanner -> Movement API), com identidade de ferramenta e colaborador validadas no servidor.
      const targets = [
        ['available', 'Marcar como disponível'],
        ['maintenance', 'Marcar como em manutenção']
      ].filter(([status]) => status !== t.status);

      items += '<hr class="ui-menu__sep" role="separator">';
      items += targets
        .map(([status, label]) => item('status', label, ` data-next-status="${status}"`))
        .join('');
    }

    const trigger = IconButton({
      label: `Mais ações de ${t.name}`,
      icon: 'icon-more',
      attributes: { 'data-tools-menu-trigger': true }
    });

    return `<div class="tools-actions-cell">${primary}<div class="tools-menu" data-dropdown>${trigger}<div class="ui-menu" aria-label="Ações de ${esc(t.name)}">${items}</div></div></div>`;
  },

  _dash: function (label) {
    return `<span aria-hidden="true">—</span><span class="ui-sr-only">${esc(label)}</span>`;
  },

  // Desktop/notebook (>= 1024): tabela semântica para comparar ferramentas lado a lado.
  renderTableView: function (tools) {
    const canManage = this.canManageTools();
    const rows = tools
      .map(
        (t) =>
          `<tr class="tools-row" data-tool-id="${esc(t.firebaseId)}"><th scope="row" class="tools-cell tools-cell--tool"><div class="tools-tool">${this._thumb(t)}<div class="tools-tool__text"><span class="tools-tool__name">${esc(t.name)}</span><span class="tools-tool__meta">${esc(t.code)} · ${esc(t.category)}</span></div></div></th><td class="tools-cell">${this._statusCell(t)}</td><td class="tools-cell">${
            t.currentUser ? esc(t.currentUser) : this._dash('Sem responsável')
          }</td><td class="tools-cell tools-cell--date">${
            t.lastAction ? esc(window.Utils.formatDate(t.lastAction)) : this._dash('Sem registro')
          }</td>${canManage ? `<td class="tools-cell tools-cell--actions">${this._actionsCell(t)}</td>` : ''}</tr>`
      )
      .join('');

    return `<div class="ui-card tools-table-wrap"><table class="tools-table"><caption class="ui-sr-only">Lista de ferramentas</caption><thead><tr><th scope="col">Ferramenta</th><th scope="col">Status</th><th scope="col">Responsável</th><th scope="col">Última ação</th>${
      canManage ? '<th scope="col"><span class="ui-sr-only">Ações</span></th>' : ''
    }</tr></thead><tbody>${rows}</tbody></table></div>`;
  },

  // Tablet/mobile (< 1024): cartões compactos, mesma informação, mesma ordem de leitura.
  renderCardsView: function (tools) {
    const items = tools
      .map(
        (t) =>
          `<li class="ui-card tools-card" data-tool-id="${esc(t.firebaseId)}"><div class="tools-tool">${this._thumb(t)}<div class="tools-tool__text"><h3 class="tools-tool__name">${esc(t.name)}</h3><span class="tools-tool__meta">${esc(t.code)} · ${esc(t.category)}</span></div></div>${this._statusCell(t)}<dl class="tools-facts">${
            t.currentUser
              ? `<div class="tools-facts__row"><dt>Responsável</dt><dd>${esc(t.currentUser)}</dd></div>`
              : ''
          }<div class="tools-facts__row"><dt>Última ação</dt><dd>${
            t.lastAction ? esc(window.Utils.formatDate(t.lastAction)) : this._dash('Sem registro')
          }</dd></div></dl>${this._actionsCell(t)}</li>`
      )
      .join('');

    return `<ul class="tools-cards" role="list">${items}</ul>`;
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
          const nextStatus = document.getElementById('crud-status').value;
          // Allow-list explícita: o valor vem de um <select>, mas não confiamos apenas no DOM
          // (poderia ser adulterado via devtools/console). 'borrowed' nunca é aceito aqui — só
          // pelo fluxo oficial de empréstimo.
          if (this.QUICK_STATUS_TARGETS.includes(nextStatus)) {
            u.status = nextStatus;
          }
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
    const tool = window.App.Data.tools.find((t) => t.firebaseId === id);
    if (tool && tool.status === 'borrowed') {
      window.App.UI.showToast(
        'Não é possível excluir uma ferramenta emprestada. Registre a devolução antes.',
        'warning'
      );
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
          dup = 0,
          rejectedBorrowed = 0;
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
          if (name.startsWith('"') && name.endsWith('"')) {
            name = name.slice(1, -1);
          }
          // Importação não pode criar ferramentas já emprestadas: entrar em empréstimo exige o
          // fluxo oficial (Scanner -> Movement API), com colaborador validado no servidor e
          // movimento registrado. A linha é rejeitada, nunca convertida silenciosamente para
          // 'available'.
          const requestedBorrowed = status === 'Emprestada' || status === 'borrowed';
          if (status === 'Disponível') {
            status = 'available';
          } else if (status === 'Manutenção' || status === 'maintenance') {
            status = 'maintenance';
          } else if (!requestedBorrowed) {
            status = 'available';
          }
          if (code && name) {
            const lC = code.toLowerCase();
            if (eC.has(lC)) {
              dup++;
              continue;
            }
            if (requestedBorrowed) {
              rejectedBorrowed++;
              continue;
            }
            eC.add(lC);
            try {
              await setDoc(doc(db, DB_BASE_PATH, COLLECTIONS.TOOLS, code), {
                code,
                name,
                category: cat,
                status,
                currentUser: null,
                lastAction: new Date().toISOString(),
                imageUrl: null,
              });
              c++;
            } catch (err) {
              window.Logger.warn(`Erro ao importar ferramenta ${code}:`, err?.message);
            }
          }
        }
        const notes = [];
        if (dup > 0) {
          notes.push(`${dup} duplicada(s) ignorada(s)`);
        }
        if (rejectedBorrowed > 0) {
          notes.push(`${rejectedBorrowed} rejeitada(s) por status "Emprestada" (não suportado na importação)`);
        }
        window.App.UI.showToast(
          `${c} ferramentas importadas.${notes.length ? ` (${notes.join('; ')})` : ''}`,
          rejectedBorrowed > 0 ? 'warning' : 'success'
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
