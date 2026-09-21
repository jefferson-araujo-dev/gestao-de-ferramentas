import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  getDocs,
  query
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, auth, DB_BASE_PATH, COLLECTIONS } from '../app.js';
import { notifications } from '../core/NotificationManager.js';
import { buildBackupV4, normalizeBackup, verifyBackupDataHash } from '../utils/backupContract.js';
import {
  HISTORY_RETENTION_DAYS,
  RESET_CONFIRM_WORD,
  RESTORE_CONFIRM_WORD,
  describeBackupApiError,
  inspectBackupFile,
  isStaleBackup,
  restoreDetails
} from '../utils/dataAdminModel.js';

const BACKUP_FILENAME_BASE = 'backup_gestao_ferramentas_v4';
const SAFETY_BACKUP_PREFIXES = Object.freeze(['pre_restore', 'pre_reset']);
const RESTORE_CONFIRMATION = 'RESTORE_OPERATIONAL_DATA';
const RESET_CONFIRMATION = 'RESET_OPERATIONAL_DATA';

async function readCollectionForBackup(collectionName) {
  const snapshot = await getDocs(collection(db, DB_BASE_PATH, collectionName));

  return snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
}

async function requestBackupApi(endpoint, body) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error('Sua sessão expirou. Entre novamente.');
  }

  const token = await currentUser.getIdToken();
  const response = await fetch(endpoint, {
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
    const error = new Error(payload?.message || 'Não foi possível concluir a operação.');
    error.details = payload;
    throw error;
  }

  return payload;
}

// Notifica o erro da API e devolve o resultado descrito (a tela mostra um Alert persistente).
// Um incidente (servidor sem conseguir reverter) exige ação do administrador: Toast persistente.
function notifyBackupApiError(error, actionLabel) {
  console.error(`Erro na ${actionLabel}:`, error?.message);
  const outcome = describeBackupApiError(error, actionLabel);

  notifications.error(
    outcome.message,
    outcome.persistent ? { persistent: true } : { duration: outcome.duration }
  );

  return { kind: outcome.kind, message: outcome.message };
}

export const AppData = {
  tools: [],
  history: [],
  users: [],
  collaborators: [],
  chartInstance: null,
  listeners: [],
  dashLimit: 12,
  crudLimit: 12,
  historyLimit: 20,
  historyUnsub: null,
  toolsLoaded: false,
  toolsError: false,
  usersLoaded: false,
  collaboratorsLoaded: false,
  collaboratorsError: false,
  allHistoryLogs: null,
  destroyListeners: function () {
    this.listeners.forEach((u) => {
      if (typeof u === 'function') {
        u();
      }
    });
    this.listeners = [];
    this.historyUnsub = null;
  },
  init: function (permissions) {
    this.destroyListeners();
    this.toolsLoaded = false;
    this.toolsError = false;
    this.usersLoaded = false;
    this.collaboratorsLoaded = false;
    this.collaboratorsError = false;
    window.App.UI.renderAll();

    if (permissions?.canReadTools === true) {
      this.listeners.push(
        onSnapshot(
          collection(db, DB_BASE_PATH, COLLECTIONS.TOOLS),
          (s) => {
            this.tools = s.docs.map((d) => ({
              firebaseId: d.id,
              ...d.data()
            }));
            this.toolsLoaded = true;
            this.toolsError = false;
            window.App.UI.renderAll();
          },
          (err) => {
            this.tools = [];
            this.toolsLoaded = true;
            this.toolsError = true;
            window.Logger.warn('Erro ao carregar ferramentas', err);
            window.App.UI.renderAll();
          }
        )
      );
    }

    if (permissions?.canAccessUsers === true) {
      this.listeners.push(
        onSnapshot(
          collection(db, DB_BASE_PATH, COLLECTIONS.USERS),
          (s) => {
            this.users = s.docs
              .map((d) => ({ firebaseId: d.id, ...d.data() }))
              .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
            this.usersLoaded = true;
            if (window.App.UI.activeTab === 'users') {
              window.App.CRUDUsers.render();
            }
            this._refreshDataScreen();
          },
          (err) => {
            this.users = [];
            this.usersLoaded = true;
            window.Logger.warn('Erro ao carregar usuarios', err);
            if (window.App.UI.activeTab === 'users') {
              window.App.CRUDUsers.render();
            }
            this._refreshDataScreen();
          }
        )
      );
    }

    if (permissions?.canReadCollaborators !== true) {
      // Sem permissão (perfil restrito): nenhum listener e nenhuma sobra de sessão anterior.
      this.collaborators = [];
      this.collaboratorsLoaded = true;
      this.collaboratorsError = false;
    } else {
      this.listeners.push(
        onSnapshot(
          collection(db, DB_BASE_PATH, COLLECTIONS.COLLABORATORS),
          (s) => {
            this.collaborators = s.docs
              .map((d) => ({ firebaseId: d.id, ...d.data() }))
              .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
            this.collaboratorsLoaded = true;
            this.collaboratorsError = false;
            if (window.App.UI.activeTab === 'collaborators') {
              window.App.CRUDCollaborators.render();
            }
            this._refreshDataScreen();
          },
          (err) => {
            this.collaborators = [];
            this.collaboratorsLoaded = true;
            // Sinal de UI: a tela distingue "falhou ao carregar" de "nenhum colaborador cadastrado".
            this.collaboratorsError = true;
            window.Logger.warn('Erro ao carregar colaboradores', err);
            if (window.App.UI.activeTab === 'collaborators') {
              window.App.CRUDCollaborators.render();
            }
            this._refreshDataScreen();
          }
        )
      );
    }

    if (permissions?.canAccessHistory === true) {
      this.loadHistoryQuery();
    }
  },
  loadHistoryQuery: function () {
    if (this.historyUnsub) {
      this.historyUnsub();
      this.listeners = this.listeners.filter((l) => l !== this.historyUnsub);
      this.historyUnsub = null;
    }
    this.historyUnsub = onSnapshot(
      collection(db, DB_BASE_PATH, COLLECTIONS.HISTORY),
      (s) => {
        this.allHistoryLogs = s.docs.map((d) => ({
          firebaseId: d.id,
          ...d.data()
        }));
        this.processAndRenderHistory();
      },
      (err) => window.Logger.error('Erro ao carregar historico.', err)
    );
    this.listeners.push(this.historyUnsub);
  },
  processAndRenderHistory: function () {
    if (!this.allHistoryLogs) {
      return;
    }
    let logs = [...this.allHistoryLogs];
    logs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const timeFilter = document.getElementById('history-time-filter')?.value || 'all';
    if (timeFilter !== 'all') {
      const d = new Date();
      if (timeFilter === 'today') {
        d.setHours(0, 0, 0, 0);
      } else if (timeFilter === '7days') {
        d.setDate(d.getDate() - 7);
      } else if (timeFilter === '30days') {
        d.setDate(d.getDate() - 30);
      }
      const isoDate = d.toISOString();
      logs = logs.filter((l) => l.date >= isoDate);
    }
    const hasMore = logs.length > this.historyLimit;
    document.getElementById('history-load-more-container')?.classList.toggle('hidden', !hasMore);
    this.history = logs.slice(0, this.historyLimit);
    window.App?.UI?.renderDashboardTimeline?.();
    if (window.App.UI.activeTab === 'history') {
      window.App.UI.renderHistory();
    }
    this._refreshDataScreen();
  },
  loadMoreHistory: function () {
    this.historyLimit += 20;
    this.processAndRenderHistory();
  },
  loadMoreDash: function () {
    this.dashLimit += 12;
    window.App.UI.renderDashboard();
  },
  loadMoreCrud: function () {
    this.crudLimit += 12;
    window.App.CRUDTools.render();
  },
  updateTool: async function (code, updates, actionType, user) {
    const searchCode = window.Utils.removeAccents(code).toLowerCase();
    const t = this.tools.find(
      (x) => window.Utils.removeAccents(x.code).toLowerCase() === searchCode
    );
    if (!t) {
      return false;
    }

    await updateDoc(doc(db, DB_BASE_PATH, COLLECTIONS.TOOLS, t.firebaseId), updates);
    if (actionType) {
      await this.logAction(t, actionType, user);
    }
    return true;
  },
  logAction: async function (tool, type, user) {
    await addDoc(collection(db, DB_BASE_PATH, COLLECTIONS.HISTORY), {
      date: new Date().toISOString(),
      toolCode: tool.code,
      toolName: tool.name,
      type: type,
      user: user || 'Sistema',
      ip: window.App.Session.currentIp || 'Desconhecido',
      device: window.App.Session.currentDevice || 'Desconhecido'
    });
  },
  // Uma operação de dados por vez (exportar, restaurar, resetar, limpar): impede duplo envio mesmo
  // que a tela falhe em desabilitar o botão. A tela ouve o evento para refletir o estado.
  _operation: null,
  isOperationRunning: function () {
    return this._operation !== null;
  },
  _beginOperation: function (name) {
    if (this._operation !== null) {
      notifications.info('Aguarde: outra operação de dados ainda está em andamento.');
      return false;
    }

    this._operation = name;
    document.dispatchEvent(new CustomEvent('data-operation', { detail: { running: true, name } }));
    return true;
  },
  // O botão só entra em "carregando" depois da confirmação do usuário (a tela ouve este evento).
  _markExecuting: function () {
    document.dispatchEvent(
      new CustomEvent('data-operation', {
        detail: { running: true, name: this._operation, executing: true }
      })
    );
  },
  _endOperation: function () {
    const name = this._operation;

    this._operation = null;
    document.dispatchEvent(new CustomEvent('data-operation', { detail: { running: false, name } }));
  },
  _refreshDataScreen: function () {
    if (window.App?.UI?.activeTab === 'data') {
      window.App.DataAdmin?.renderLive?.();
    }
  },
  cleanOldLogs: async function () {
    if (window.App?.Auth?.permissions?.canBackupData !== true) {
      notifications.error('Acesso restrito a administradores.');
      return { status: 'denied' };
    }

    if (!this._beginOperation('clean-history')) {
      return { status: 'busy' };
    }

    try {
      const retentionMs = HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const limitIso = () => new Date(Date.now() - retentionMs).toISOString();
      const estimated = Array.isArray(this.allHistoryLogs)
        ? this.allHistoryLogs.filter((log) => log.date && log.date < limitIso()).length
        : null;

      if (estimated === 0) {
        notifications.info(
          `Nenhum registro de histórico com mais de ${HISTORY_RETENTION_DAYS} dias.`
        );
        return { status: 'nothing' };
      }

      const confirmed = await window.App.UI.confirm({
        title: `Excluir o histórico com mais de ${HISTORY_RETENTION_DAYS} dias?`,
        description: `Ação administrativa: os registros de histórico (auditoria) mais antigos que ${HISTORY_RETENTION_DAYS} dias serão excluídos permanentemente do banco de dados.`,
        details: [
          estimated === null
            ? 'A quantidade exata será calculada ao executar.'
            : `${estimated} registro(s) serão excluídos.`,
          `Ferramentas, colaboradores, usuários e os registros dos últimos ${HISTORY_RETENTION_DAYS} dias não são alterados.`,
          'Nenhum backup é gerado automaticamente: se precisar guardar esses registros, exporte um backup antes.'
        ],
        warning: 'Esta ação não pode ser desfeita.',
        confirmLabel: 'Excluir registros antigos',
        variant: 'danger'
      });

      if (!confirmed) {
        return { status: 'cancelled' };
      }

      this._markExecuting();

      const old = limitIso();
      const s = await getDocs(query(collection(db, DB_BASE_PATH, COLLECTIONS.HISTORY)));
      let del = 0;
      const deletePromises = [];
      s.forEach((d) => {
        const data = d.data();
        if (data.date && data.date < old) {
          deletePromises.push(deleteDoc(doc(db, DB_BASE_PATH, COLLECTIONS.HISTORY, d.id)));
          del++;
        }
      });
      await Promise.all(deletePromises);
      notifications.success(`${del} registros antigos excluidos.`);
      return { status: 'done', deleted: del };
    } catch (error) {
      console.error('Erro ao limpar o histórico:', error?.message);
      notifications.error(`Erro ao limpar o histórico: ${error?.message || error}`, {
        duration: 10000
      });
      return { status: 'failed', message: error?.message || String(error) };
    } finally {
      this._endOperation();
    }
  },
  resetAllData: async function () {
    if (window.App?.Auth?.permissions?.canBackupData !== true) {
      notifications.error('Acesso restrito a administradores.');
      return { status: 'denied' };
    }

    if (!this._beginOperation('reset')) {
      return { status: 'busy' };
    }

    try {
      const historyCount = Array.isArray(this.allHistoryLogs) ? this.allHistoryLogs.length : null;
      const confirmed = await window.App.UI.confirm({
        title: 'Resetar os dados operacionais?',
        description: 'Todas as ferramentas, colaboradores e o histórico serão apagados do sistema.',
        details: [
          `Serão apagados: ${this.tools.length} ferramenta(s), ${this.collaborators.length} colaborador(es)${
            historyCount === null
              ? ' e todo o histórico'
              : ` e ${historyCount} registro(s) de histórico`
          }.`,
          'Usuários e contas de acesso são preservados.',
          'Um backup de segurança do estado atual é baixado antes de apagar.'
        ],
        warning:
          'Não existe botão de desfazer: só é possível recuperar os dados restaurando o backup de segurança baixado.',
        confirmLabel: 'Resetar dados',
        variant: 'danger',
        requireText: RESET_CONFIRM_WORD
      });

      if (!confirmed) {
        return { status: 'cancelled' };
      }

      this._markExecuting();

      const safetyBackup = await this._generateBackup({ filenamePrefix: 'pre_reset' });
      if (!safetyBackup) {
        const message = 'Não foi possível gerar o backup de segurança. Reset cancelado.';

        notifications.error(message);
        return { status: 'failed', kind: 'safety-backup', message };
      }

      notifications.info('Resetando dados operacionais...');
      const response = await requestBackupApi('/api/backup/reset', {
        confirmation: RESET_CONFIRMATION
      });

      window.AudioSys?.playBeep?.('success');
      const message = `Dados operacionais resetados e verificados (${response.data?.totalDeleted ?? 0} registros). Usuários preservados.`;

      notifications.success(message);
      window.App.Data.init(window.App.Auth.permissions);
      return { status: 'done', message };
    } catch (error) {
      return { status: 'failed', ...notifyBackupApiError(error, 'reset') };
    } finally {
      this._endOperation();
    }
  },
  exportJSON: async function (options) {
    if (window.App?.Auth?.permissions?.canBackupData !== true) {
      notifications.error('Acesso restrito a administradores.');
      return null;
    }

    if (!this._beginOperation('export')) {
      return null;
    }

    this._markExecuting();

    try {
      return await this._generateBackup(options);
    } finally {
      this._endOperation();
    }
  },
  // Gera e baixa o backup v4. Uso interno (exportJSON e os backups de segurança de restore/reset).
  _generateBackup: async function (options) {
    const safetyPrefix = SAFETY_BACKUP_PREFIXES.includes(options?.filenamePrefix)
      ? options.filenamePrefix
      : '';

    notifications.info(safetyPrefix ? 'Gerando backup de segurança...' : 'Gerando backup...');

    try {
      const [tools, collaborators, history, users] = await Promise.all(
        [COLLECTIONS.TOOLS, COLLECTIONS.COLLABORATORS, COLLECTIONS.HISTORY, COLLECTIONS.USERS].map(
          readCollectionForBackup
        )
      );
      const backup = await buildBackupV4({ tools, collaborators, history, users });
      const validation = normalizeBackup(backup);

      const now = new Date().toISOString();
      const suffix = safetyPrefix ? `_${now.slice(11, 19).replace(/:/g, '')}` : '';
      const filename = `${safetyPrefix ? `${safetyPrefix}_` : ''}${BACKUP_FILENAME_BASE}_${now.slice(0, 10)}${suffix}.json`;

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.AudioSys?.playBeep?.('success');
      notifications.success(
        `Backup exportado com sucesso! ${backup.summary.totalRecords} registros operacionais.`
      );

      if (!validation.ok) {
        notifications.warning(
          `Atenção: este backup não passaria na validação de restauração (${validation.errorCount} problema(s) nos dados atuais).`,
          { duration: 8000 }
        );
      }

      return backup;
    } catch (error) {
      console.error('Erro ao gerar backup:', error?.message);
      notifications.error(`Erro ao gerar backup: ${error.message || error}`);
      return null;
    }
  },
  latestKnownActivity: function () {
    const dates = [
      ...(this.allHistoryLogs || []).map((log) => log.date),
      ...this.tools.map((tool) => tool.lastAction)
    ]
      .map((value) => (typeof value === 'string' ? Date.parse(value) : NaN))
      .filter((value) => !Number.isNaN(value));

    return dates.length > 0 ? Math.max(...dates) : null;
  },
  // SELECIONAR + VALIDAR + REVISAR: lê e valida o arquivo localmente. Nada é enviado nem alterado.
  inspectBackupFile: async function (file) {
    if (window.App?.Auth?.permissions?.canBackupData !== true) {
      notifications.error('Acesso restrito a administradores.');
      return null;
    }

    return inspectBackupFile(file, { latestActivity: this.latestKnownActivity() });
  },
  // CONFIRMAR + EXECUTAR: restaura a partir de um arquivo já inspecionado (inspectBackupFile).
  restoreBackup: async function (inspection) {
    if (window.App?.Auth?.permissions?.canBackupData !== true) {
      notifications.error('Acesso restrito a administradores.');
      return { status: 'denied' };
    }

    if (inspection?.ok !== true || !inspection.payload) {
      const message = 'Selecione e valide um arquivo de backup antes de restaurar.';

      notifications.error(message);
      return { status: 'invalid', message };
    }

    if (!this._beginOperation('restore')) {
      return { status: 'busy' };
    }

    try {
      const parsed = inspection.payload;
      const validation = normalizeBackup(parsed, { requireNonEmpty: true });
      if (!validation.ok) {
        const message = `Backup inválido (${validation.errorCount} problema(s)). Nenhum dado foi alterado.`;

        notifications.error(message, { duration: 10000 });
        return { status: 'invalid', message };
      }

      const { meta } = validation;
      if (!meta.legacy && !(await verifyBackupDataHash(validation.backup)).ok) {
        const message = 'O hash do backup não confere. Nenhum dado foi alterado.';

        notifications.error(message);
        return { status: 'invalid', message };
      }

      const confirmed = await window.App.UI.confirm({
        title: 'Restaurar os dados operacionais?',
        description:
          'Os dados atuais de ferramentas, colaboradores e histórico serão substituídos pelo conteúdo do arquivo.',
        details: restoreDetails(meta, { fileName: inspection.fileName }),
        warning:
          'Não existe botão de desfazer: só é possível voltar ao estado atual restaurando o backup de segurança baixado.',
        confirmLabel: 'Restaurar dados',
        variant: 'danger',
        requireText: RESTORE_CONFIRM_WORD
      });

      if (!confirmed) {
        return { status: 'cancelled' };
      }

      if (isStaleBackup(meta.exportedAt, this.latestKnownActivity())) {
        const staleConfirmed = await window.App.UI.confirmDanger(
          'Restaurar um backup mais antigo que o sistema?',
          'Este backup é MAIS ANTIGO que a atividade mais recente registrada no sistema. Restaurá-lo apagará essa atividade posterior.',
          'Restaurar mesmo assim'
        );
        if (!staleConfirmed) {
          return { status: 'cancelled' };
        }
      }

      this._markExecuting();

      const safetyBackup = await this._generateBackup({ filenamePrefix: 'pre_restore' });
      if (!safetyBackup) {
        const message = 'Não foi possível gerar o backup de segurança. Restauração cancelada.';

        notifications.error(message);
        return { status: 'failed', kind: 'safety-backup', message };
      }

      notifications.info('Restaurando dados no servidor...');
      const response = await requestBackupApi('/api/backup/restore', {
        backup: parsed,
        confirmation: RESTORE_CONFIRMATION
      });

      window.AudioSys?.playBeep?.('success');
      const message = `Backup restaurado e verificado: ${response.data?.totalRecords ?? meta.totalRecords} registros. Usuários preservados.`;

      notifications.success(message);
      window.App.Data.init(window.App.Auth.permissions);
      return { status: 'done', message };
    } catch (error) {
      return { status: 'failed', ...notifyBackupApiError(error, 'restauração') };
    } finally {
      this._endOperation();
    }
  },
  exportExcel: async function () {
    if (window.App?.Auth?.permissions?.canExportData !== true) {
      notifications.error('Acesso restrito a administradores.');
      return;
    }

    if (!window.XLSX) {
      notifications.info('Carregando motor de planilhas...');
      try {
        await window.Utils.loadScript(
          'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
        );
      } catch {
        return notifications.error('Erro ao carregar o motor.');
      }
    }
    const data = this.tools.map((t) => ({
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
      'Ultima Acao': t.lastAction ? new Date(t.lastAction).toLocaleString('pt-BR') : ''
    }));
    const ws = window.XLSX.utils.json_to_sheet(data);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    window.XLSX.writeFile(wb, `inventario_ferramentas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  },

  /**
   * Importa dados de um arquivo Excel (.xlsx, .xls)
   */
  importExcel: async function (event) {
    const file = event?.target?.files?.[0];
    if (!file) {
      return { status: 'none' };
    }

    if (window.App?.Auth?.permissions?.canManageTools !== true) {
      notifications.error('Acesso restrito a administradores.');
      event.target.value = '';
      return { status: 'denied' };
    }

    // Verifica extensão
    const validExts = ['.xlsx', '.xls'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!validExts.includes(ext)) {
      const message = 'Formato inválido. Use .xlsx ou .xls';

      notifications.error(message);
      event.target.value = '';
      return { status: 'invalid', message };
    }

    // Confirma importação: cadastra ferramentas novas; não altera nem remove as existentes.
    const confirmed = await window.App.UI.confirmAction(
      'Importar ferramentas da planilha?',
      `Cada linha válida de "${file.name}" será cadastrada como uma nova ferramenta. Ferramentas existentes não são alteradas nem removidas, mas o código (patrimônio) não é verificado: linhas repetidas criam ferramentas duplicadas.`,
      'Importar planilha'
    );
    if (!confirmed) {
      event.target.value = '';
      return { status: 'cancelled' };
    }

    if (!this._beginOperation('import-excel')) {
      event.target.value = '';
      return { status: 'busy' };
    }

    this._markExecuting();

    try {
      notifications.info('Importando arquivo Excel...');

      // Carrega biblioteca XLSX se necessário
      if (!window.XLSX) {
        await window.Utils?.loadScript?.(
          'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
        );
      }

      // Lê arquivo
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = window.XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!rows.length) {
        throw new Error('Arquivo vazio ou formato inválido');
      }

      // Processa linhas (assume colunas: Patrimônio, Descrição, Categoria, Status, etc.)
      let imported = 0;
      const errors = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const code = String(row['Patrimônio'] || row['Codigo'] || row['Code'] || '').trim();
          const name = String(
            row['Descrição'] || row['Descricao'] || row['Nome'] || row['Name'] || ''
          ).trim();
          const category = String(row['Categoria'] || row['Category'] || 'Geral').trim();
          const statusRaw = String(row['Status'] || 'available').toLowerCase();

          if (!code || !name) {
            errors.push(`Linha ${i + 2}: Código ou Nome vazio`);
            continue;
          }

          // Mapeia status
          let status = 'available';
          if (statusRaw.includes('emprest') || statusRaw === 'borrowed') {
            status = 'borrowed';
          } else if (statusRaw.includes('manuten') || statusRaw === 'maintenance') {
            status = 'maintenance';
          }

          await addDoc(collection(db, DB_BASE_PATH, COLLECTIONS.TOOLS), {
            code,
            name,
            category,
            status,
            createdAt: new Date().toISOString(),
            lastAction: new Date().toISOString(),
            currentUser: row['Responsável'] || row['Responsavel'] || null,
            imageUrl: null,
            notes: row['Observações'] || row['Observacoes'] || row['Notes'] || null
          });

          imported++;
        } catch (err) {
          errors.push(`Linha ${i + 2}: ${err.message}`);
        }
      }

      window.AudioSys?.playBeep?.('success');
      let msg = `${imported} ferramenta(s) importada(s) com sucesso!`;
      if (errors.length > 0) {
        msg += ` ${errors.length} erro(s).`;
        console.warn('Import errors:', errors);
      }
      notifications.success(msg);

      // Recarrega dados (com as permissões atuais: sem elas os listeners não voltam)
      window.App?.Data?.init?.(window.App.Auth.permissions);
      return { status: 'done', message: msg, imported, errorCount: errors.length };
    } catch (error) {
      const message = `Erro ao importar a planilha: ${error?.message || error}`;

      console.error('Erro ao importar Excel:', error?.message);
      notifications.error(message, { duration: 10000 });
      return { status: 'failed', message };
    } finally {
      event.target.value = '';
      this._endOperation();
    }
  }
};
