import { Alert, Button, Card, Input, Skeleton, isBusy, setBusy } from '../components/index.js';
import { esc } from '../components/util.js';
import { metrics } from '../core/MetricsManager.js';
import { BACKUP_SCHEMA_VERSION, LEGACY_BACKUP_VERSION } from '../utils/backupContract.js';
import {
  HISTORY_RETENTION_DAYS,
  formatDateTime,
  formatFileSize,
  restoreDetails
} from '../utils/dataAdminModel.js';

/**
 * Tela "Dados e backup" (Gate 1-F1), somente administradores (rota #/dados; o modelo de navegação e
 * o guard de App.UI.switchTab já recusam os demais perfis ANTES de qualquer render daqui).
 *
 * Esta camada é só apresentação: as operações (exportar, restaurar, resetar, limpar histórico) e as
 * confirmações continuam em App.Data, que mantém o contrato v4 e as guardas server-side. Nada aqui
 * lê, mostra ou registra o conteúdo de um backup: somente nome, tamanho, schema, data e contagens.
 *
 * Restauração em etapas: SELECIONAR (arquivo) -> VALIDAR (local) -> REVISAR (resumo) ->
 * CONFIRMAR (ConfirmDialog reforçado) -> EXECUTAR (backup de segurança + API). Selecionar um
 * arquivo nunca envia nada.
 */
const FEEDBACK_AREAS = ['backup', 'restore', 'excel', 'maintenance'];

const SECTION_IDS = Object.freeze({
  summary: 'data-h-summary',
  backup: 'data-h-backup',
  restore: 'data-h-restore',
  maintenance: 'data-h-maintenance',
  metrics: 'data-h-metrics'
});

const fact = (key, label, { text = false } = {}) =>
  `<div class="data-fact" data-fact="${key}"><dt class="data-fact__label">${esc(label)}</dt><dd class="data-fact__value${text ? ' data-fact__value--text' : ''}"></dd></div>`;

const feedbackRegion = (area) =>
  `<div class="data-feedback" id="data-feedback-${area}" data-feedback="${area}"></div>`;

const section = (key, title, lead, body, { danger = false } = {}) =>
  `<section class="data-section${danger ? ' data-section--danger' : ''}" aria-labelledby="${SECTION_IDS[key]}">${Card(
    {
      header: `<h2 class="data-section__title" id="${SECTION_IDS[key]}">${esc(title)}</h2>${
        lead ? `<p class="data-section__lead">${esc(lead)}</p>` : ''
      }`,
      body
    }
  )}</section>`;

function buildScreen() {
  const summary = section(
    'summary',
    'Resumo',
    'Situação atual dos dados operacionais, com o que o sistema já carregou.',
    `<dl class="data-facts">${[
      fact('tools', 'Ferramentas'),
      fact('collaborators', 'Colaboradores'),
      fact('history', 'Registros de histórico'),
      fact('users', 'Usuários (só referência)'),
      fact('activity', 'Atividade mais recente', { text: true }),
      fact('schema', 'Formato do backup', { text: true })
    ].join('')}</dl>`
  );

  const backup = section(
    'backup',
    'Backup',
    'Ação segura: gera um arquivo e não altera nenhum dado.',
    `<div class="data-block"><h3 class="data-block__title">O que o arquivo contém</h3><ul class="data-list"><li>Ferramentas, colaboradores e histórico (restauráveis).</li><li>Uma referência dos usuários, sem dados sensíveis: serve só de consulta e nunca é restaurada.</li><li>Data e hora da exportação e um código de integridade (SHA-256).</li></ul><p class="data-block__text">O arquivo (JSON, formato ${esc(BACKUP_SCHEMA_VERSION)}) é baixado no seu dispositivo. Nada é enviado para fora do sistema.</p><div class="data-actions">${Button(
      {
        label: 'Exportar backup (JSON)',
        variant: 'primary',
        icon: 'icon-download',
        id: 'data-export-backup',
        attributes: { 'data-data-action': 'export' }
      }
    )}</div>${feedbackRegion('backup')}</div>`
  );

  const restore = section(
    'restore',
    'Importação e restauração',
    'Restaurar substitui dados atuais. O arquivo é validado neste dispositivo antes de qualquer envio.',
    `<div class="data-block"><h3 class="data-block__title">Restaurar de um backup (JSON)</h3><p class="data-block__text">1. Selecione o arquivo. 2. Revise o resumo. 3. Confirme a restauração. Selecionar o arquivo não envia nada.</p>${Input(
      {
        label: 'Arquivo de backup (.json)',
        id: 'data-restore-file',
        type: 'file',
        help: 'Aceita o formato 4.0 e o legado 3.0, com até 4 MB.',
        attributes: { accept: '.json,application/json' }
      }
    )}<div class="data-review" id="data-restore-review" aria-live="polite"></div><p class="data-block__text" id="data-restore-hint">A restauração só é habilitada com um arquivo válido.</p><div class="data-actions">${Button(
      {
        label: 'Restaurar dados…',
        variant: 'danger',
        icon: 'icon-import',
        id: 'data-restore-run',
        disabled: true,
        attributes: { 'data-data-action': 'restore', 'aria-describedby': 'data-restore-hint' }
      }
    )}${Button({
      label: 'Remover arquivo',
      variant: 'secondary',
      id: 'data-restore-clear',
      attributes: { 'data-data-action': 'clear-file', hidden: true }
    })}</div>${feedbackRegion('restore')}</div><div class="data-block"><h3 class="data-block__title">Importar ferramentas de uma planilha (Excel)</h3><p class="data-block__text">Cadastra novas ferramentas a partir das linhas da planilha. Não altera nem remove as existentes e não verifica códigos repetidos.</p>${Input(
      {
        label: 'Planilha (.xlsx ou .xls)',
        id: 'data-excel-file',
        type: 'file',
        attributes: { accept: '.xlsx,.xls' }
      }
    )}${feedbackRegion('excel')}</div>`
  );

  const maintenance = section(
    'maintenance',
    'Manutenção de dados',
    'Ações administrativas destrutivas: pedem confirmação e não têm botão de desfazer.',
    `${Alert({
      tone: 'warning',
      title: 'Exporte um backup antes',
      message:
        'As ações desta seção apagam dados do banco de forma permanente. O reset baixa um backup de segurança automaticamente; a limpeza de histórico não.',
      className: 'data-alert'
    })}<div class="data-block"><h3 class="data-block__title">Excluir histórico antigo</h3><p class="data-block__text">Remove os registros de histórico (auditoria) com mais de ${HISTORY_RETENTION_DAYS} dias. Ferramentas, colaboradores e usuários não são afetados.</p><div class="data-actions">${Button(
      {
        label: `Excluir histórico com mais de ${HISTORY_RETENTION_DAYS} dias`,
        variant: 'danger',
        icon: 'icon-trash',
        id: 'data-clean-history',
        attributes: { 'data-data-action': 'clean-history' }
      }
    )}</div></div><div class="data-block"><h3 class="data-block__title">Resetar dados operacionais</h3><p class="data-block__text">Apaga todas as ferramentas, colaboradores e o histórico. Usuários e contas de acesso são preservados. Um backup de segurança é baixado antes.</p><div class="data-actions">${Button(
      {
        label: 'Resetar dados operacionais…',
        variant: 'danger',
        icon: 'icon-trash',
        id: 'data-reset',
        attributes: { 'data-data-action': 'reset' }
      }
    )}</div>${feedbackRegion('maintenance')}</div>`,
    { danger: true }
  );

  const metricsSection = section(
    'metrics',
    'Métricas de uso',
    'Medidas que o próprio app calcula neste navegador; não são enviadas ao servidor.',
    `<dl class="data-facts">${[
      fact('uptime', 'Tempo ativo (sessão)', { text: true }),
      fact('errorRate', 'Taxa de erros ocultos', { text: true }),
      fact('borrowed', 'Empréstimos via scanner'),
      fact('returned', 'Devoluções via scanner')
    ].join('')}</dl>`
  );

  return `<p class="data-intro">Área administrativa para backup, restauração e manutenção dos dados operacionais. Usuários e contas de acesso nunca são alterados por estas ações.</p>${summary}${backup}${restore}${maintenance}${metricsSection}`;
}

export const AppDataAdmin = {
  _mounted: false,
  _bound: false,
  _inspection: null,
  _inspecting: false,
  _inspectToken: 0,
  _running: false,
  _activeButton: null,

  $(id) {
    return document.getElementById(id);
  },

  // Renderiza (na 1ª vez) e atualiza. Só é chamada com a aba "Dados e backup" ativa, isto é, depois
  // de o guard de rota ter aceito o perfil administrador.
  render() {
    const host = this.$('data-screen');

    if (!host) {
      return;
    }

    if (!this._mounted) {
      host.innerHTML = buildScreen();
      this._mounted = true;
      this._bind(host);
    }

    this.renderLive();
    this._syncControls();
  },

  // Resumo e métricas: valores derivados do que App.Data já carregou (não toca no arquivo/feedback).
  renderLive() {
    if (!this._mounted) {
      return;
    }

    const data = window.App?.Data;
    const set = (key, html) => {
      const value = document.querySelector(`[data-fact="${key}"] .data-fact__value`);

      if (value) {
        value.innerHTML = html;
        value.toggleAttribute('aria-busy', html.includes('ui-skeleton'));
      }
    };
    const count = (loaded, size) =>
      loaded ? String(size) : Skeleton({ width: '3rem', height: '1.5rem' });
    const latest = data?.latestKnownActivity?.() ?? null;

    set('tools', count(data?.toolsLoaded, data?.tools?.length ?? 0));
    set('collaborators', count(data?.collaboratorsLoaded, data?.collaborators?.length ?? 0));
    set('users', count(data?.usersLoaded, data?.users?.length ?? 0));
    set(
      'history',
      Array.isArray(data?.allHistoryLogs)
        ? String(data.allHistoryLogs.length)
        : Skeleton({ width: '3rem', height: '1.5rem' })
    );
    set(
      'activity',
      esc(latest === null ? 'Sem registros' : formatDateTime(new Date(latest).toISOString()))
    );
    set('schema', esc(`${BACKUP_SCHEMA_VERSION} (aceita também ${LEGACY_BACKUP_VERSION})`));

    const report = metrics.getReport();

    set('uptime', esc(report.summary.uptimeFormatted));
    set('errorRate', esc(report.summary.errorRate));
    set('borrowed', String(report.counters['tools.borrowed_total'] || 0));
    set('returned', String(report.counters['tools.returned_total'] || 0));
  },

  // Ao sair da tela: descarta o arquivo lido (pode conter dados pessoais) e os avisos antigos.
  reset() {
    this._inspectToken += 1;
    this._inspection = null;
    this._inspecting = false;

    if (!this._mounted) {
      return;
    }

    for (const id of ['data-restore-file', 'data-excel-file']) {
      const input = this.$(id);

      if (input) {
        input.value = '';
      }
    }

    FEEDBACK_AREAS.forEach((area) => this.setFeedback(area, null));
    this._renderReview();
    this._syncControls();
  },

  _bind(host) {
    if (this._bound) {
      return;
    }

    this._bound = true;

    host.addEventListener('click', (event) => {
      const button = event.target.closest('[data-data-action]');

      if (!button || isBusy(button) || button.disabled) {
        return;
      }

      this._onAction(button.dataset.dataAction, button);
    });

    host.addEventListener('change', (event) => {
      if (event.target.id === 'data-restore-file') {
        this._inspectSelected();
      } else if (event.target.id === 'data-excel-file') {
        this._importExcel(event);
      }
    });

    // Operações iniciadas em qualquer lugar (App.Data) refletem nos controles da tela. O botão
    // acionado só entra em "carregando" quando a operação de fato começa (depois da confirmação).
    document.addEventListener('data-operation', (event) => {
      if (event.detail?.executing && this._activeButton) {
        setBusy(this._activeButton, true);
      }

      this._syncControls();
    });
  },

  _onAction(action, button) {
    if (action === 'export') {
      this._run(button, async () => {
        const backup = await window.App.Data.exportJSON();

        if (!backup) {
          this.setFeedback('backup', {
            tone: 'danger',
            title: 'Não foi possível gerar o backup',
            message: 'Nenhum dado foi alterado. Tente novamente.'
          });
        }
      });
    } else if (action === 'restore') {
      this._run(button, async () => {
        const result = await window.App.Data.restoreBackup(this._inspection);

        this._showResult('restore', result, 'Restauração não concluída');

        if (result?.status === 'done') {
          this._clearFile();
        }
      });
    } else if (action === 'clear-file') {
      this._clearFile();
      this.$('data-restore-file')?.focus();
    } else if (action === 'clean-history') {
      this._run(button, async () => {
        const result = await window.App.Data.cleanOldLogs();

        this._showResult('maintenance', result, 'Não foi possível limpar o histórico', {
          done: `${result?.deleted ?? 0} registro(s) de histórico excluído(s).`,
          nothing: `Nenhum registro com mais de ${HISTORY_RETENTION_DAYS} dias.`
        });
      });
    } else if (action === 'reset') {
      this._run(button, async () => {
        const result = await window.App.Data.resetAllData();

        this._showResult('maintenance', result, 'Reset não concluído');
      });
    }
  },

  // Uma operação por vez: o botão acionado fica em "carregando" (aria-busy) quando a operação começa
  // e os demais desabilitados.
  async _run(button, task) {
    if (this._running || window.App.Data.isOperationRunning()) {
      return;
    }

    this._running = true;
    this._activeButton = button;
    FEEDBACK_AREAS.forEach((area) => this.setFeedback(area, null));
    this._syncControls();

    try {
      await task();
    } finally {
      setBusy(button, false);
      this._activeButton = null;
      this._running = false;
      this._syncControls();
    }
  },

  async _importExcel(event) {
    if (this._running || window.App.Data.isOperationRunning()) {
      event.target.value = '';
      return;
    }

    this._running = true;
    this.setFeedback('excel', null);
    this._syncControls();

    try {
      const result = await window.App.Data.importExcel(event);

      this._showResult('excel', result, 'Não foi possível importar a planilha');
    } finally {
      this._running = false;
      this._syncControls();
    }
  },

  // Feedback persistente (Alert) do resultado: erro/incidente não somem como um toast curto.
  _showResult(area, result, failTitle, messages = {}) {
    if (!result) {
      return;
    }

    if (result.status === 'done') {
      this.setFeedback(area, {
        tone: 'success',
        title: 'Concluído',
        message: messages.done ?? result.message ?? ''
      });
    } else if (result.status === 'nothing') {
      this.setFeedback(area, { tone: 'info', title: messages.nothing ?? 'Nada a fazer' });
    } else if (result.status === 'failed' || result.status === 'invalid') {
      this.setFeedback(area, {
        tone: 'danger',
        title:
          result.kind === 'incident' ? 'Incidente: ação do administrador necessária' : failTitle,
        message: result.message ?? ''
      });
    }
  },

  setFeedback(area, alert) {
    const region = this.$(`data-feedback-${area}`);

    if (region) {
      region.innerHTML = alert ? Alert(alert) : '';
    }
  },

  // ---------------------------------------------------------------- restauração em etapas

  async _inspectSelected() {
    const file = this.$('data-restore-file')?.files?.[0];
    const token = ++this._inspectToken;

    this._inspection = null;
    this.setFeedback('restore', null);

    if (!file) {
      this._inspecting = false;
      this._renderReview();
      this._syncControls();
      return;
    }

    this._inspecting = true;
    this._renderReview();
    this._syncControls();

    const inspection = await window.App.Data.inspectBackupFile(file);

    // Seleção trocada durante a leitura: a resposta antiga é descartada.
    if (token !== this._inspectToken) {
      return;
    }

    this._inspecting = false;
    this._inspection = inspection;
    this._renderReview();
    this._syncControls();
  },

  _clearFile() {
    this._inspectToken += 1;
    this._inspection = null;
    this._inspecting = false;

    const input = this.$('data-restore-file');

    if (input) {
      input.value = '';
    }

    this._renderReview();
    this._syncControls();
  },

  _renderReview() {
    const region = this.$('data-restore-review');
    const input = this.$('data-restore-file');

    if (!region) {
      return;
    }

    const inspection = this._inspection;
    const failed = inspection && inspection.ok !== true;

    if (input) {
      if (failed) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
      input.setAttribute(
        'aria-describedby',
        failed ? 'data-restore-file-help data-restore-alert' : 'data-restore-file-help'
      );
    }

    if (this._inspecting) {
      region.innerHTML = '<p class="data-block__text">Validando o arquivo…</p>';
      return;
    }

    if (!inspection) {
      region.innerHTML = '';
      return;
    }

    const fileCard = `<div class="data-file"><p class="data-file__name">${esc(inspection.fileName)}</p><p class="data-file__meta">${esc(formatFileSize(inspection.fileSize))}</p></div>`;

    if (failed) {
      region.innerHTML = `${fileCard}${Alert({
        tone: 'danger',
        id: 'data-restore-alert',
        title: 'Este arquivo não pode ser restaurado',
        message: `${inspection.message} Nenhum dado foi alterado.`
      })}`;
      return;
    }

    const lines = restoreDetails(inspection.meta).map((line) => `<li>${esc(line)}</li>`);
    const notices = [
      Alert({
        tone: 'success',
        title: 'Arquivo válido',
        message: 'Schema reconhecido e integridade conferida. Nada foi enviado ainda.'
      })
    ];

    if (inspection.stale) {
      notices.push(
        Alert({
          tone: 'warning',
          title: 'Backup mais antigo que o sistema',
          message:
            'Este backup é mais antigo que a atividade mais recente registrada. Restaurá-lo apagará essa atividade posterior.'
        })
      );
    }

    region.innerHTML = `${fileCard}<h3 class="data-block__title">Revise antes de restaurar</h3><ul class="data-review__list">${lines.join('')}</ul>${notices.join('')}`;
  },

  _syncControls() {
    if (!this._mounted) {
      return;
    }

    const busy = this._running || Boolean(window.App?.Data?.isOperationRunning?.());
    const set = (id, disabled) => {
      const control = this.$(id);

      if (control && !isBusy(control) && control !== this._activeButton) {
        control.disabled = disabled;
      }
    };

    set('data-export-backup', busy);
    set('data-restore-run', busy || this._inspecting || this._inspection?.ok !== true);
    set('data-clean-history', busy);
    set('data-reset', busy);
    set('data-restore-file', busy);
    set('data-excel-file', busy);

    const clear = this.$('data-restore-clear');

    if (clear) {
      clear.hidden = !this._inspection && !this._inspecting;
      clear.disabled = busy;
    }

    const hint = this.$('data-restore-hint');

    if (hint) {
      hint.hidden = this._inspection?.ok === true;
    }
  }
};
