/**
 * AutoBackupManager - Sistema automático de backup com agendamento
 * Pattern: Scheduler com retry e validação
 */

import { eventBus } from '../core/EventEmitter.js';
import { errorHandler, DatabaseError } from '../core/ErrorHandler.js';
import { metrics } from '../core/MetricsManager.js';
import { CONFIG, COLLECTIONS, DB_BASE_PATH } from '../app.js';
import { db } from '../app.js';
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { notifications } from '../core/NotificationManager.js';

export class AutoBackupManager {
  constructor() {
    this._interval = null;
    this._isEnabled = false;
    this._isRunning = false;
    this._lastBackup = null;
    this._backupHistory = [];
    this._maxHistory = 50;
    this._retryAttempts = 3;
    this._retryDelay = 5000;
    this._listeners = [];

    this._loadHistory();
  }

  /**
   * Inicia o backup automático
   */
  start(intervalMs = CONFIG.AUTO_BACKUP_INTERVAL) {
    if (this._isEnabled) {
      console.warn('[AutoBackup] Already running');
      return this;
    }

    this._isEnabled = true;
    this._interval = setInterval(() => {
      this._performBackup();
    }, intervalMs);

    eventBus.emit('backup:start', { interval: intervalMs });
    console.info(`[AutoBackup] Started with interval: ${intervalMs}ms`);

    return this;
  }

  /**
   * Para o backup automático
   */
  stop() {
    if (!this._isEnabled) {
      return this;
    }

    this._isEnabled = false;
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }

    eventBus.emit('backup:stop');
    console.info('[AutoBackup] Stopped');

    return this;
  }

  /**
   * Executa um backup manual
   */
  async backup(options = {}) {
    const {
      showProgress = true,
      includeHistory = true,
      compress = false,
      onProgress = null
    } = options;

    if (this._isRunning) {
      throw new Error('Backup already in progress');
    }

    this._isRunning = true;
    metrics.startTimer('backup');
    eventBus.emit('backup:started');

    try {
      if (showProgress) {
        notifications.info('Iniciando backup...');
      }

      // Step 1: Collect all data
      if (onProgress) {
        onProgress(10, 'Coletando dados...');
      }
      const data = await this._collectData(includeHistory);

      // Step 2: Validate data
      if (onProgress) {
        onProgress(30, 'Validando dados...');
      }
      this._validateData(data);

      // Step 3: Create backup object
      if (onProgress) {
        onProgress(50, 'Criando backup...');
      }
      const backup = this._createBackupObject(data);

      // Step 4: Compress if needed
      if (onProgress) {
        onProgress(70, compress ? 'Comprimindo...' : 'Finalizando...');
      }
      const finalBackup = compress ? await this._compressBackup(backup) : backup;

      // Step 5: Download
      if (onProgress) {
        onProgress(90, 'Baixando arquivo...');
      }
      this._downloadBackup(finalBackup);

      // Step 6: Save to history
      this._addToHistory(finalBackup);

      // Success
      metrics.stopTimer('backup', { size: finalBackup.size });
      metrics.increment('backup.success');
      eventBus.emit('backup:complete', { size: finalBackup.size });

      if (showProgress) {
        notifications.success(`Backup concluído! ${this._formatBackupSize(finalBackup)}`);
      }

      this._lastBackup = {
        timestamp: new Date().toISOString(),
        size: finalBackup.size,
        records: finalBackup.summary.totalRecords
      };

      return finalBackup;
    } catch (error) {
      metrics.increment('backup.error');
      eventBus.emit('backup:error', error);

      await errorHandler.handleError(error, { operation: 'backup' });
      throw error;
    } finally {
      this._isRunning = false;
    }
  }

  /**
   * Restaura um backup
   */
  async restore(backupFile, options = {}) {
    const { showProgress = true, onProgress = null } = options;

    if (!backupFile) {
      throw new Error('Backup file is required');
    }

    this._isRunning = true;
    metrics.startTimer('restore');
    eventBus.emit('restore:started');

    try {
      if (showProgress) {
        notifications.info('Iniciando restauração...');
      }

      // Step 1: Read file
      if (onProgress) {
        onProgress(10, 'Lendo arquivo...');
      }
      const backupData = await this._readBackupFile(backupFile);

      // Step 2: Validate backup
      if (onProgress) {
        onProgress(20, 'Validando backup...');
      }
      this._validateBackupStructure(backupData);

      // Step 3: Confirm restore
      if (onProgress) {
        onProgress(30, 'Preparando restauração...');
      }
      const confirmed =
        options.forceConfirm !== false &&
        confirm('ATENÇÃO: Isso irá substituir TODOS os dados atuais!\n\nDeseja continuar?');

      if (!confirmed) {
        throw new Error('Restore cancelled by user');
      }

      // Step 4: Clear existing data
      if (onProgress) {
        onProgress(40, 'Limpando dados atuais...');
      }
      await this._clearAllData();

      // Step 5: Restore collections
      if (onProgress) {
        onProgress(60, 'Restaurando dados...');
      }
      await this._restoreCollections(backupData);

      // Step 6: Verify
      if (onProgress) {
        onProgress(90, 'Verificando integridade...');
      }
      await this._verifyRestore(backupData);

      // Success
      metrics.stopTimer('restore', {
        records: backupData.summary?.totalRecords || 0
      });
      metrics.increment('restore.success');
      eventBus.emit('restore:complete');

      if (showProgress) {
        notifications.success('Backup restaurado com sucesso!');
      }

      // Reload app data
      window.App?.Data?.init();
    } catch (error) {
      metrics.increment('restore.error');
      eventBus.emit('restore:error', error);

      await errorHandler.handleError(error, { operation: 'restore' });
      throw error;
    } finally {
      this._isRunning = false;
    }
  }

  /**
   * Obtém histórico de backups
   */
  getHistory() {
    return [...this._backupHistory];
  }

  /**
   * Obtém último backup
   */
  getLastBackup() {
    return this._lastBackup;
  }

  /**
   * Limpa histórico
   */
  clearHistory() {
    this._backupHistory = [];
    localStorage.removeItem('backup-history');
    return this;
  }

  /**
   * Coleta todos os dados do Firestore
   */
  async _collectData(includeHistory) {
    const collections = [COLLECTIONS.TOOLS, COLLECTIONS.USERS, COLLECTIONS.COLLABORATORS];

    if (includeHistory) {
      collections.push(COLLECTIONS.HISTORY);
    }

    const data = {};
    let totalRecords = 0;

    for (const colName of collections) {
      const colRef = collection(db, DB_BASE_PATH, colName);
      const snapshot = await getDocs(colRef);

      data[colName] = [];
      snapshot.forEach((doc) => {
        data[colName].push({
          id: doc.id,
          ...doc.data()
        });
      });

      totalRecords += data[colName].length;
    }

    return { data, totalRecords };
  }

  /**
   * Valida dados coletados
   */
  _validateData(data) {
    if (!data || !data.data) {
      throw new DatabaseError('Dados inválidos para backup');
    }

    for (const [collection, items] of Object.entries(data.data)) {
      if (!Array.isArray(items)) {
        throw new DatabaseError(`Coleção ${collection} inválida`);
      }
    }
  }

  /**
   * Cria objeto de backup
   */
  _createBackupObject(data) {
    return {
      version: CONFIG.APP_ID,
      exportDate: new Date().toISOString(),
      exportTimestamp: Date.now(),
      summary: {
        totalRecords: data.totalRecords,
        collections: Object.keys(data.data).length,
        collectionSizes: Object.fromEntries(
          Object.entries(data.data).map(([key, items]) => [key, items.length])
        )
      },
      system: {
        userAgent: navigator.userAgent,
        screenResolution: `${screen.width}x${screen.height}`,
        language: navigator.language
      },
      data: data.data
    };
  }

  /**
   * Comprime backup (placeholder para implementação futura)
   */
  async _compressBackup(backup) {
    // Future: Use Compression Streams API
    // https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API
    return backup;
  }

  /**
   * Download do arquivo de backup
   */
  _downloadBackup(backup) {
    const jsonString = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `backup_gestao_ferramentas_${date}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  /**
   * Lê arquivo de backup
   */
  async _readBackupFile(file) {
    const text = await file.text();
    return JSON.parse(text);
  }

  /**
   * Valida estrutura do backup
   */
  _validateBackupStructure(backup) {
    if (!backup.data || typeof backup.data !== 'object') {
      throw new DatabaseError('Formato de backup inválido');
    }

    if (!backup.version || backup.version !== CONFIG.APP_ID) {
      console.warn('[AutoBackup] Backup version mismatch');
    }
  }

  /**
   * Limpa todos os dados do Firestore
   */
  async _clearAllData() {
    const collections = [
      COLLECTIONS.TOOLS,
      COLLECTIONS.USERS,
      COLLECTIONS.COLLABORATORS,
      COLLECTIONS.HISTORY
    ];

    for (const colName of collections) {
      const snapshot = await getDocs(collection(db, DB_BASE_PATH, colName));
      const deletePromises = snapshot.docs.map((d) =>
        deleteDoc(doc(db, DB_BASE_PATH, colName, d.id))
      );
      await Promise.all(deletePromises);
    }
  }

  /**
   * Restaura coleções do backup
   */
  async _restoreCollections(backup) {
    let totalRestored = 0;

    for (const [colName, items] of Object.entries(backup.data)) {
      for (const item of items) {
        const { id, ...data } = item;
        await setDoc(doc(db, DB_BASE_PATH, colName, id), data);
        totalRestored++;
      }
    }

    console.info(`[AutoBackup] Restored ${totalRestored} records`);
  }

  /**
   * Verifica integridade após restauração
   */
  async _verifyRestore(backup) {
    for (const [colName, items] of Object.entries(backup.data)) {
      const snapshot = await getDocs(collection(db, DB_BASE_PATH, colName));
      if (snapshot.size !== items.length) {
        console.warn(`[AutoBackup] Count mismatch in ${colName}`);
      }
    }
  }

  /**
   * Executa backup automático
   */
  async _performBackup() {
    if (this._isRunning) {
      return;
    }

    try {
      await this.backup({
        showProgress: false,
        onProgress: null
      });
    } catch (error) {
      console.error('[AutoBackup] Auto backup failed:', error);
    }
  }

  /**
   * Adiciona ao histórico
   */
  _addToHistory(backup) {
    const entry = {
      timestamp: backup.exportDate,
      size: backup.size || 0,
      records: backup.summary?.totalRecords || 0,
      collections: backup.summary?.collections || 0
    };

    this._backupHistory.unshift(entry);
    if (this._backupHistory.length > this._maxHistory) {
      this._backupHistory = this._backupHistory.slice(0, this._maxHistory);
    }

    this._saveHistory();
  }

  /**
   * Salva histórico no localStorage
   */
  _saveHistory() {
    try {
      localStorage.setItem('backup-history', JSON.stringify(this._backupHistory));
    } catch (error) {
      console.warn('[AutoBackup] Failed to save history:', error);
    }
  }

  /**
   * Carrega histórico do localStorage
   */
  _loadHistory() {
    try {
      const data = localStorage.getItem('backup-history');
      if (data) {
        this._backupHistory = JSON.parse(data);
      }
    } catch (error) {
      console.warn('[AutoBackup] Failed to load history:', error);
    }
  }

  /**
   * Formata tamanho do backup
   */
  _formatBackupSize(backup) {
    const bytes = JSON.stringify(backup).length;
    const kb = bytes / 1024;
    return kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb.toFixed(2)} KB`;
  }

  /**
   * Destrói e limpa recursos
   */
  destroy() {
    this.stop();
    this.clearHistory();
  }
}

// Singleton instance
export const autoBackup = new AutoBackupManager();
