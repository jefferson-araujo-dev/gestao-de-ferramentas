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

const BACKUP_FILENAME_BASE = 'backup_gestao_ferramentas_v4';
const SAFETY_BACKUP_PREFIXES = Object.freeze(['pre_restore', 'pre_reset']);
const RESTORE_CONFIRMATION = 'RESTORE_OPERATIONAL_DATA';
const RESET_CONFIRMATION = 'RESET_OPERATIONAL_DATA';
const MAX_RESTORE_FILE_BYTES = 4000000;

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

function notifyBackupApiError(error, actionLabel) {
  console.error(`Erro na ${actionLabel}:`, error?.message);
  const details = error?.details;

  if (details?.incident === true) {
    notifications.error(
      `INCIDENTE na ${actionLabel}: o servidor não conseguiu reverter ao estado anterior. Não repita a operação, guarde o backup de segurança baixado e avise um administrador do sistema.`,
      { duration: 20000 }
    );
    return;
  }

  if (details?.rolledBack === true) {
    notifications.error(
      `A ${actionLabel} falhou na verificação e o estado anterior foi restaurado automaticamente. Nenhum dado foi perdido.`,
      { duration: 10000 }
    );
    return;
  }

  if (details?.applied === false) {
    notifications.error(`A ${actionLabel} não foi aplicada. Nenhum dado foi alterado.`, {
      duration: 10000
    });
    return;
  }

  notifications.error(`Erro na ${actionLabel}: ${error?.message || error}`, { duration: 10000 });
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
  usersLoaded: false,
  collaboratorsLoaded: false,
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
    this.usersLoaded = false;
    this.collaboratorsLoaded = false;
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
            window.App.UI.renderAll();
          },
          (err) => {
            this.tools = [];
            this.toolsLoaded = true;
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
          },
          (err) => {
            this.users = [];
            this.usersLoaded = true;
            window.Logger.warn('Erro ao carregar usuarios', err);
            if (window.App.UI.activeTab === 'users') {
              window.App.CRUDUsers.render();
            }
          }
        )
      );
    }

    if (permissions?.canReadCollaborators !== true) {
      // Sem permissão (perfil restrito): nenhum listener e nenhuma sobra de sessão anterior.
      this.collaborators = [];
      this.collaboratorsLoaded = true;
    } else {
      this.listeners.push(
        onSnapshot(
          collection(db, DB_BASE_PATH, COLLECTIONS.COLLABORATORS),
          (s) => {
            this.collaborators = s.docs
              .map((d) => ({ firebaseId: d.id, ...d.data() }))
              .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
            this.collaboratorsLoaded = true;
            if (window.App.UI.activeTab === 'collaborators') {
              window.App.CRUDCollaborators.render();
            }
          },
          (err) => {
            this.collaborators = [];
            this.collaboratorsLoaded = true;
            window.Logger.warn('Erro ao carregar colaboradores', err);
            if (window.App.UI.activeTab === 'collaborators') {
              window.App.CRUDCollaborators.render();
            }
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
  cleanOldLogs: async function () {
    if (!confirm('Deseja excluir registros > 30 dias?')) {
      return;
    }
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

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
  },
  resetAllData: async function () {
    if (window.App?.Auth?.permissions?.canBackupData !== true) {
      notifications.error('Acesso restrito a administradores.');
      return;
    }

    const confirmText =
      'RESETAR DADOS OPERACIONAIS\n\n- As ferramentas serão apagadas\n- Os colaboradores serão apagados\n- O histórico será apagado\n- Usuários e contas de acesso serão PRESERVADOS\n\nUm backup de segurança será baixado antes.\n\nTem certeza que deseja continuar?';
    if (!confirm(confirmText)) {
      return;
    }

    if (!confirm('ÚLTIMA CHANCE! Confirme para apagar os dados operacionais.')) {
      return;
    }

    try {
      const safetyBackup = await this.exportJSON({ filenamePrefix: 'pre_reset' });
      if (!safetyBackup) {
        notifications.error('Não foi possível gerar o backup de segurança. Reset cancelado.');
        return;
      }

      notifications.info('Resetando dados operacionais...');
      const response = await requestBackupApi('/api/backup/reset', {
        confirmation: RESET_CONFIRMATION
      });

      window.AudioSys?.playBeep?.('success');
      notifications.success(
        `Dados operacionais resetados e verificados (${response.data?.totalDeleted ?? 0} registros). Usuários preservados.`
      );
      window.App.Data.init(window.App.Auth.permissions);
    } catch (error) {
      notifyBackupApiError(error, 'reset');
    }
  },
  exportJSON: async function (options) {
    if (window.App?.Auth?.permissions?.canBackupData !== true) {
      notifications.error('Acesso restrito a administradores.');
      return null;
    }

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
      console.error('Erro ao gerar backup:', error);
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
  importJSON: async function (event) {
    const input = event?.target;
    const file = input?.files?.[0];
    const clearInput = () => {
      if (input) {
        input.value = '';
      }
    };

    if (window.App?.Auth?.permissions?.canBackupData !== true) {
      notifications.error('Acesso restrito a administradores.');
      clearInput();
      return;
    }

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith('.json')) {
      notifications.error('Por favor, selecione um arquivo JSON válido.');
      clearInput();
      return;
    }

    if (file.size > MAX_RESTORE_FILE_BYTES) {
      notifications.error('O arquivo excede o tamanho máximo aceito para restauração.');
      clearInput();
      return;
    }

    try {
      notifications.info('Lendo arquivo de backup...');

      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error('O arquivo não é um JSON válido.');
      }

      const validation = normalizeBackup(parsed, { requireNonEmpty: true });
      if (!validation.ok) {
        const codes = [...new Set(validation.errors.map((error) => error.code))].join(', ');
        notifications.error(
          `Backup inválido (${validation.errorCount} problema(s): ${codes}). Nenhum dado foi alterado.`,
          { duration: 10000 }
        );
        return;
      }

      const { meta } = validation;
      if (!meta.legacy && !(await verifyBackupDataHash(validation.backup)).ok) {
        notifications.error('O hash do backup não confere. Nenhum dado foi alterado.');
        return;
      }

      const summary = [
        'RESTAURAR DADOS OPERACIONAIS',
        '',
        `Formato: ${meta.sourceSchema} | Exportado em: ${new Date(meta.exportedAt).toLocaleString('pt-BR')}`,
        `Ferramentas: ${meta.counts.tools} | Colaboradores: ${meta.counts.collaborators} | Histórico: ${meta.counts.history}`
      ];

      if (meta.legacy) {
        summary.push(
          '',
          `ATENÇÃO: backup LEGADO 3.0 será adaptado. ${meta.statusDefaulted} colaborador(es) sem status receberão "active".`
        );
      }

      summary.push(
        '',
        'Ferramentas, colaboradores e histórico atuais serão SUBSTITUÍDOS pelo conteúdo do arquivo.',
        'Usuários e contas de acesso serão PRESERVADOS (usuários do backup não são restaurados).',
        'Um backup de segurança será baixado antes.',
        '',
        'Deseja continuar?'
      );

      if (!confirm(summary.join('\n'))) {
        return;
      }

      const latestActivity = this.latestKnownActivity();
      if (latestActivity !== null && latestActivity > Date.parse(meta.exportedAt)) {
        const staleConfirmed = confirm(
          'ATENÇÃO: este backup é MAIS ANTIGO que a atividade mais recente registrada no sistema.\n\nRestaurá-lo apagará essa atividade posterior.\n\nDeseja realmente continuar?'
        );
        if (!staleConfirmed) {
          return;
        }
      }

      const safetyBackup = await this.exportJSON({ filenamePrefix: 'pre_restore' });
      if (!safetyBackup) {
        notifications.error('Não foi possível gerar o backup de segurança. Restauração cancelada.');
        return;
      }

      notifications.info('Restaurando dados no servidor...');
      const response = await requestBackupApi('/api/backup/restore', {
        backup: parsed,
        confirmation: RESTORE_CONFIRMATION
      });

      window.AudioSys?.playBeep?.('success');
      notifications.success(
        `Backup restaurado e verificado: ${response.data?.totalRecords ?? meta.totalRecords} registros. Usuários preservados.`
      );
      window.App.Data.init(window.App.Auth.permissions);
    } catch (error) {
      notifyBackupApiError(error, 'restauração');
    } finally {
      clearInput();
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
      return;
    }

    // Verifica extensão
    const validExts = ['.xlsx', '.xls'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!validExts.includes(ext)) {
      notifications.error('Formato inválido. Use .xlsx ou .xls');
      event.target.value = '';
      return;
    }

    // Confirma importação
    const confirmed = confirm(
      'ATENÇÃO: Isso irá importar dados do arquivo Excel!\n\nDeseja continuar?'
    );
    if (!confirmed) {
      event.target.value = '';
      return;
    }

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

      // Recarrega dados
      window.App?.Data?.init?.();
    } finally {
      event.target.value = '';
    }
  }
};
