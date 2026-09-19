import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  getDocs,
  query
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, DB_BASE_PATH, COLLECTIONS } from '../app.js';
import { notifications } from '../core/NotificationManager.js';

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

    if (permissions?.canReadCollaborators === true) {
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
    const confirmText =
      'ATENÇÃO: Isso irá apagar TODOS os dados do sistema!\n\n- Ferramentas\n- Usuários\n- Colaboradores\n- Histórico\n\nTem certeza que deseja continuar?';
    if (!confirm(confirmText)) {
      return;
    }

    const secondConfirm = confirm(
      'ÚLTIMA CHANCE! Digite OK para confirmar o reset completo dos dados.'
    );
    if (secondConfirm !== true) {
      return;
    }

    notifications.info('Resetando dados...');

    const collections = [
      COLLECTIONS.TOOLS,
      COLLECTIONS.USERS,
      COLLECTIONS.COLLABORATORS,
      COLLECTIONS.HISTORY
    ];

    for (const colName of collections) {
      const snapshot = await getDocs(collection(db, DB_BASE_PATH, colName));
      const deletePromises = [];
      snapshot.forEach((d) => {
        deletePromises.push(deleteDoc(doc(db, DB_BASE_PATH, colName, d.id)));
      });
      await Promise.all(deletePromises);
      console.info(`Coleção ${colName} limpa.`);
    }

    window.AudioSys.playBeep('success');
    notifications.success('Todos os dados foram resetados com sucesso!');
  },
  exportJSON: async function () {
    if (window.App?.Auth?.permissions?.canBackupData !== true) {
      notifications.error('Acesso restrito a administradores.');
      return;
    }

    notifications.info('Gerando backup...');

    const collections = [
      COLLECTIONS.TOOLS,
      COLLECTIONS.USERS,
      COLLECTIONS.COLLABORATORS,
      COLLECTIONS.HISTORY
    ];

    const backupData = {
      exportDate: new Date().toISOString(),
      version: '3.0',
      data: {}
    };

    for (const colName of collections) {
      const snapshot = await getDocs(collection(db, DB_BASE_PATH, colName));
      backupData.data[colName] = [];
      snapshot.forEach((d) => {
        backupData.data[colName].push({
          id: d.id,
          ...d.data()
        });
      });
      console.info(`Coleção ${colName} exportada: ${backupData.data[colName].length} registros.`);
    }

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_gestao_ferramentas_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    window.AudioSys.playBeep('success');
    notifications.success(
      `Backup exportado com sucesso! ${Object.values(backupData.data).reduce((acc, arr) => acc + arr.length, 0)} registros.`
    );
  },
  importJSON: async function (event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    if (!file.name.endsWith('.json')) {
      notifications.error('Por favor, selecione um arquivo JSON válido.');
      event.target.value = '';
      return;
    }

    const confirmRestore = confirm(
      'ATENÇÃO: Isso irá substituir TODOS os dados atuais pelos dados do backup!\n\nTem certeza que deseja continuar?'
    );
    if (!confirmRestore) {
      event.target.value = '';
      return;
    }

    try {
      notifications.info('Lendo arquivo de backup...');

      const text = await file.text();
      const backupData = JSON.parse(text);

      if (!backupData.data) {
        throw new Error('Formato de backup inválido.');
      }

      notifications.info('Restaurando dados...');

      const collections = [
        COLLECTIONS.TOOLS,
        COLLECTIONS.USERS,
        COLLECTIONS.COLLABORATORS,
        COLLECTIONS.HISTORY
      ];

      let totalRestored = 0;
      let usersRestoreBlocked = false;
      const failedCollections = [];

      for (const colName of collections) {
        if (!backupData.data[colName]) {
          continue;
        }

        try {
          const colRef = collection(db, DB_BASE_PATH, colName);

          // Limpar coleção atual
          const existingSnapshot = await getDocs(colRef);
          const deletePromises = [];
          existingSnapshot.forEach((d) => {
            deletePromises.push(deleteDoc(doc(db, DB_BASE_PATH, colName, d.id)));
          });
          await Promise.all(deletePromises);

          // Restaurar dados do backup
          const restorePromises = [];
          backupData.data[colName].forEach((item) => {
            const { id, ...data } = item;
            restorePromises.push(setDoc(doc(db, DB_BASE_PATH, colName, id), data));
          });
          await Promise.all(restorePromises);

          totalRestored += backupData.data[colName].length;
          console.info(
            `Coleção ${colName} restaurada: ${backupData.data[colName].length} registros.`
          );
        } catch (colError) {
          if (colName === COLLECTIONS.USERS) {
            usersRestoreBlocked = true;
            console.warn(`Coleção ${colName} não pôde ser restaurada:`, colError);
          } else {
            failedCollections.push(colName);
            console.error(`Falha ao restaurar a coleção ${colName}:`, colError);
            notifications.error(
              `Falha ao restaurar a coleção "${colName}": ${colError.message || colError}`
            );
          }
        }
      }

      if (usersRestoreBlocked) {
        notifications.warning(
          'A coleção "users" não foi restaurada: por segurança, o Firestore só permite alterar usuários por um processo administrativo (Admin SDK), não pelo navegador. As demais coleções do backup foram processadas normalmente.',
          { duration: 8000 }
        );
      }

      if (failedCollections.length === 0) {
        window.AudioSys.playBeep('success');
        notifications.success(`Backup restaurado com sucesso! ${totalRestored} registros.`);
      }

      // Recarregar dados
      window.App.Data.init();
    } catch (error) {
      console.error('Erro ao restaurar backup:', error);
      notifications.error(`Erro ao restaurar backup: ${error.message || error}`);
    } finally {
      event.target.value = '';
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
          'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
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
          'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
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
