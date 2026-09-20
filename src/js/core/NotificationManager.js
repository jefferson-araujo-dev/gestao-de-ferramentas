/**
 * AdvancedNotificationManager - Sistema avançado de notificações
 * Pattern: Builder com templates e prioridades
 */

import { eventBus } from '../core/EventEmitter.js';
import { TOAST_LABELS, toastDuration, toastRole } from '../components/toast-policy.js';
import { Button, IconButton } from '../components/actions.js';

export class NotificationManager {
  constructor() {
    this._container = null;
    this._notifications = [];
    this._maxVisible = 5;
    this._queue = [];
    this._isProcessing = false;
    this._defaultDuration = 4000;
    this._templates = new Map();
    this._soundEnabled = true;

    this._registerDefaultTemplates();
  }

  /**
   * Inicializa o container de notificações
   */
  init() {
    this._container = document.getElementById('toast-container');
    if (!this._container) {
      console.warn('[NotificationManager] Container #toast-container não encontrado');
      return this;
    }

    // Regiões vivas PERSISTENTES (criadas antes de qualquer toast, para o leitor de tela anunciar):
    // "status" (educado) para sucesso/informação e "alert" (assertivo) para erro/aviso.
    this._container.setAttribute('role', 'region');
    this._container.setAttribute('aria-label', 'Notificações');
    this._regions = {};
    ['status', 'alert'].forEach((role) => {
      const region = document.createElement('div');

      region.className = 'ui-toast-region';
      region.setAttribute('role', role);
      region.dataset.toastRegion = role;
      this._container.appendChild(region);
      this._regions[role] = region;
    });

    return this;
  }

  /**
   * Mostra uma notificação de sucesso
   */
  success(message, options = {}) {
    return this.show({ type: 'success', message, ...options });
  }

  /**
   * Mostra uma notificação de erro
   */
  error(message, options = {}) {
    return this.show({ type: 'error', message, ...options });
  }

  /**
   * Mostra uma notificação de aviso
   */
  warning(message, options = {}) {
    return this.show({ type: 'warning', message, ...options });
  }

  /**
   * Mostra uma notificação de informação
   */
  info(message, options = {}) {
    return this.show({ type: 'info', message, ...options });
  }

  /**
   * Mostra uma notificação customizada
   */
  show(options) {
    const notification = {
      id: this._generateId(),
      visible: false,
      ...this._parseOptions(options)
    };

    // Emit evento
    eventBus.emit('notification:show', notification);

    // Adiciona à fila
    this._queue.push(notification);
    this._processQueue();

    return notification.id;
  }

  /**
   * Remove uma notificação específica
   */
  dismiss(id) {
    const index = this._notifications.findIndex((n) => n.id === id);
    if (index !== -1) {
      this._removeNotification(index);
    }
  }

  /**
   * Remove todas as notificações
   */
  dismissAll() {
    [...this._notifications].forEach((_, index) => {
      this._removeNotification(index);
    });
    this._queue = [];
  }

  /**
   * Registra um template customizado
   */
  registerTemplate(name, templateFn) {
    this._templates.set(name, templateFn);
    return this;
  }

  /**
   * Usa um template customizado
   */
  useTemplate(name, data = {}) {
    const templateFn = this._templates.get(name);
    if (!templateFn) {
      throw new Error(`Template "${name}" não encontrado`);
    }

    const options = templateFn(data);
    return this.show(options);
  }

  /**
   * Mostra notificação de progresso
   */
  progress(message, progress, options = {}) {
    const id = options.id || this._generateId();
    const percentage = Math.min(100, Math.max(0, progress));

    const notification = {
      id,
      type: 'progress',
      message,
      progress: percentage,
      duration: Infinity,
      visible: true,
      ...options
    };

    this._renderNotification(notification);
    eventBus.emit('notification:progress', { id, progress: percentage });

    if (percentage >= 100) {
      setTimeout(() => this.dismiss(id), 1000);
    }

    return id;
  }

  /**
   * Mostra notificação de ação com undo
   */
  action(message, actionFn, actionLabel = 'Desfazer', options = {}) {
    const id = this.show({
      type: 'info',
      message,
      duration: 6000,
      action: {
        fn: actionFn,
        label: actionLabel
      },
      ...options
    });

    return id;
  }

  /**
   * Configura som de notificações
   */
  setSound(enabled) {
    this._soundEnabled = enabled;
    return this;
  }

  /**
   * Obtém notificações ativas
   */
  getActive() {
    return this._notifications.filter((n) => n.visible);
  }

  /**
   * Obtém fila de espera
   */
  getQueue() {
    return [...this._queue];
  }

  /**
   * Processa a fila de notificações
   */
  _processQueue() {
    if (this._isProcessing) {
      return;
    }
    if (this._queue.length === 0) {
      return;
    }
    if (this._notifications.filter((n) => n.visible).length >= this._maxVisible) {
      return;
    }

    this._isProcessing = true;

    const notification = this._queue.shift();
    this._notifications.push(notification);

    this._renderNotification(notification);

    setTimeout(() => {
      this._isProcessing = false;
      this._processQueue();
    }, 100);
  }

  /**
   * Renderiza uma notificação no DOM (Toast do design system).
   * - Vive numa região viva persistente (role="status" ou "alert").
   * - Tipo repetido em texto para leitor de tela (não só cor/ícone).
   * - Botão de fechar acessível; pausa a contagem com mouse/foco (WCAG 2.2.1).
   */
  _renderNotification(notification) {
    if (!this._container) {
      return;
    }

    const role = toastRole(notification.type);
    const region = this._regions?.[role] || this._container;
    const element = document.createElement('div');

    element.id = `notification-${notification.id}`;
    element.className = `toast-item ui-toast ui-toast--${notification.type}`;
    element.dataset.type = notification.type;
    element.innerHTML = this._getNotificationHTML(notification);

    const closeBtn = element.querySelector('[data-dismiss]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.dismiss(notification.id);
      });
    }

    const actionBtn = element.querySelector('[data-action]');
    if (actionBtn && notification.action) {
      actionBtn.addEventListener('click', () => {
        notification.action.fn();
        this.dismiss(notification.id);
      });
    }

    region.appendChild(element);
    notification.visible = true;

    requestAnimationFrame(() => {
      element.classList.add('show');
    });

    if (this._soundEnabled) {
      this._playSound(notification.type);
    }

    this._scheduleDismiss(notification, element);
  }

  /**
   * Fecha sozinho após a duração da política; hover/foco SUSPENDEM a contagem e ao sair ela retoma
   * com o tempo restante. Duração Infinity = só fecha manualmente.
   */
  _scheduleDismiss(notification, element) {
    if (notification.duration === Infinity) {
      return;
    }

    let remaining = notification.duration;
    let startedAt = 0;
    let timer = null;

    const start = () => {
      startedAt = Date.now();
      timer = setTimeout(() => this.dismiss(notification.id), remaining);
    };
    const pause = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        remaining = Math.max(1500, remaining - (Date.now() - startedAt));
      }
    };

    element.addEventListener('mouseenter', pause);
    element.addEventListener('focusin', pause);
    element.addEventListener('mouseleave', () => {
      if (!timer && !element.matches(':focus-within')) {
        start();
      }
    });
    element.addEventListener('focusout', () => {
      if (!timer && !element.matches(':hover')) {
        start();
      }
    });
    start();
  }

  /**
   * Remove notificação do DOM
   */
  _removeNotification(index) {
    const notification = this._notifications[index];
    if (!notification) {
      return;
    }

    const element = document.getElementById(`notification-${notification.id}`);
    if (element) {
      element.classList.remove('show');
      element.classList.add('hide');

      setTimeout(() => {
        element.remove();
        eventBus.emit('notification:dismiss', notification.id);
      }, 300);
    }

    notification.visible = false;
    this._notifications.splice(index, 1);
  }

  /**
   * HTML interno: ícone decorativo + tipo (oculto visualmente) + mensagem + ação + fechar.
   */
  _getNotificationHTML(notification) {
    const label = TOAST_LABELS[notification.type] || TOAST_LABELS.info;
    const iconId =
      {
        success: 'icon-check-circle',
        error: 'icon-x-circle',
        warning: 'icon-alert-triangle',
        info: 'icon-info',
        progress: 'icon-info'
      }[notification.type] || 'icon-info';

    const progressBar =
      notification.type === 'progress'
        ? `<div class="ui-toast__progress" role="progressbar" aria-label="Progresso" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(notification.progress || 0)}"><div class="ui-toast__progress-bar" style="width: ${Number(notification.progress) || 0}%"></div></div>`
        : '';

    const actionButton = notification.action
      ? Button({ label: notification.action.label, variant: 'secondary', size: 'sm', attributes: { 'data-action': true } })
      : '';

    return `
      <svg class="ui-toast__icon" aria-hidden="true" focusable="false"><use href="#${iconId}"></use></svg>
      <p class="ui-toast__body"><span class="ui-sr-only">${label}: </span><span class="ui-toast__message">${this._escapeHTML(notification.message)}</span></p>
      ${actionButton}
      ${IconButton({ label: 'Fechar notificação', icon: 'icon-close', attributes: { 'data-dismiss': true } })}
      ${progressBar}
    `;
  }

  /**
   * Registra templates padrão
   */
  _registerDefaultTemplates() {
    // Template para operações em lote
    this.registerTemplate('batch-operation', (data) => ({
      type: 'success',
      message: `${data.count} ${data.item}(s) ${data.action}(s) com sucesso!`,
      duration: 4000
    }));

    // Template para erros de rede
    this.registerTemplate('network-error', (data) => ({
      type: 'error',
      message: `Erro de conexão: ${data.message || 'Verifique sua internet'}`,
      duration: 6000
    }));

    // Template para backup
    this.registerTemplate('backup-complete', (data) => ({
      type: 'success',
      message: `Backup concluído! ${data.total || 0} registros exportados.`,
      duration: 5000
    }));

    // Template para sessão
    this.registerTemplate('session-expired', () => ({
      type: 'warning',
      message: 'Sessão expirada. Redirecionando para login...',
      duration: 3000
    }));

    // Template para sincronização
    this.registerTemplate('sync-complete', (data) => ({
      type: 'info',
      message: `Dados sincronizados! ${data.count || 0} registros atualizados.`,
      duration: 3000
    }));
  }

  /**
   * Toca som de notificação
   */
  _playSound(type) {
    try {
      if (!window.AudioContext && !window.webkitAudioContext) {
        return;
      }

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      const sounds = {
        success: { frequency: 880, duration: 0.1, type: 'sine' },
        error: { frequency: 220, duration: 0.3, type: 'sawtooth' },
        warning: { frequency: 440, duration: 0.2, type: 'square' },
        info: { frequency: 660, duration: 0.15, type: 'sine' }
      };

      const sound = sounds[type] || sounds.info;
      oscillator.type = sound.type;
      oscillator.frequency.setValueAtTime(sound.frequency, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.05, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + sound.duration);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + sound.duration);
    } catch (error) {
      console.warn('[NotificationManager] Error playing sound:', error);
    }
  }

  /**
   * Parse e merge de opções
   */
  _parseOptions(options) {
    const type = options.type || 'info';

    return {
      priority: 'normal',
      ...options,
      duration: toastDuration(type, options.message, {
        duration: options.duration,
        persistent: options.persistent
      })
    };
  }

  /**
   * Gera ID único
   */
  _generateId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Escape HTML para segurança
   */
  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Singleton instance
export const notifications = new NotificationManager();
