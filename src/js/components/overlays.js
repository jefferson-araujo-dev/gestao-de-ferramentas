import { setBusy, isBusy, Button, IconButton } from './actions.js';
import { Alert } from './display.js';
import { esc, uid } from './util.js';

/**
 * Overlays (Gate 1-E): política de fechamento de Modal, ConfirmDialog e Dropdown.
 * Vanilla JS sobre <dialog> nativo. Nada aqui executa ação de negócio.
 */

// ---------------------------------------------------------------------------------------------
// MODAL — política explícita de fechamento
// ---------------------------------------------------------------------------------------------
// `data-dismissible="true"` (padrão): Esc, gesto "voltar" e clique no fundo fecham (closedby="any").
// `data-dismissible="false"`: clique no fundo NUNCA fecha; Esc/voltar são pedidos de fechamento e,
// se o formulário tiver alterações, pedem confirmação em vez de descartar em silêncio.
const FIELD_SELECTOR = 'input, select, textarea';
const HAS_CLOSEDBY =
  typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

export const isDismissible = (dialog) => dialog.dataset.dismissible !== 'false';

function snapshotForm(dialog) {
  return [...dialog.querySelectorAll(FIELD_SELECTOR)]
    .filter((field) => field.type !== 'hidden' && field.type !== 'file' && field.type !== 'button')
    .map((field) =>
      field.type === 'checkbox' || field.type === 'radio'
        ? `${field.name || field.id}:${field.checked}`
        : `${field.name || field.id}:${field.value}`
    )
    .join('|');
}

/** Há campos e o valor atual difere do capturado na abertura. */
export function isDirty(dialog) {
  return dialog._initialSnapshot !== undefined && dialog._initialSnapshot !== snapshotForm(dialog);
}

// Dá nome acessível ao diálogo a partir do primeiro título, quando faltar.
function ensureAccessibleName(dialog) {
  if (dialog.hasAttribute('aria-label') || dialog.hasAttribute('aria-labelledby')) {
    return;
  }

  const heading = dialog.querySelector('h1, h2, h3');

  if (heading) {
    heading.id ||= uid(`${dialog.id || 'dialog'}-title`);
    dialog.setAttribute('aria-labelledby', heading.id);
  }
}

function prepareDialog(dialog) {
  if (dialog._modalReady) {
    return;
  }

  dialog._modalReady = true;
  ensureAccessibleName(dialog);
  dialog.setAttribute('closedby', isDismissible(dialog) ? 'any' : 'closerequest');

  // Captura o estado inicial do formulário quando o diálogo abre (valores já preenchidos pelo app).
  new MutationObserver(() => {
    if (dialog.open) {
      dialog._initialSnapshot = snapshotForm(dialog);
    }
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  // Fallback de clique no fundo para navegadores sem `closedby` (Safari): só se dismissível.
  if (!HAS_CLOSEDBY) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog || !isDismissible(dialog)) {
        return;
      }

      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;

      if (!inside) {
        dialog.close();
      }
    });
  }

  // Pedido de fechamento (Esc / voltar) em diálogo NÃO dismissível com alterações: confirma antes.
  dialog.addEventListener('cancel', (event) => {
    if (isDismissible(dialog) || !isDirty(dialog)) {
      return;
    }

    event.preventDefault();
    confirmDialog({
      title: 'Descartar alterações?',
      description:
        'Há alterações não salvas neste formulário. Se fechar agora, elas serão perdidas.',
      confirmLabel: 'Descartar',
      cancelLabel: 'Continuar editando',
      variant: 'danger'
    }).then((discard) => {
      if (discard) {
        dialog._initialSnapshot = snapshotForm(dialog);
        dialog.close();
      }
    });
  });
}

/** Aplica a política a todos os <dialog> do documento (e aos adicionados depois, via chamada). */
export function initModals(root = document) {
  root.querySelectorAll('dialog').forEach(prepareDialog);

  if (root._modalCloseBound) {
    return;
  }

  root._modalCloseBound = true;
  // Botões [data-modal-close] fecham o diálogo que os contém (sem onclick inline).
  root.addEventListener('click', (event) => {
    const closer = event.target.closest?.('[data-modal-close]');

    if (closer) {
      closer.closest('dialog')?.close();
    }
  });
}

/** HTML de um modal padrão: título associado, descrição opcional, header, body, footer e fechar. */
export function ModalShell({
  id,
  title,
  description = '',
  body = '',
  footer = '',
  dismissible = true,
  className = ''
} = {}) {
  if (!id || !title) {
    throw new Error('ModalShell exige "id" e "title".');
  }

  return `<dialog id="${esc(id)}" class="ui-modal ${esc(className)}" aria-labelledby="${esc(id)}-title"${
    description ? ` aria-describedby="${esc(id)}-desc"` : ''
  } data-dismissible="${dismissible ? 'true' : 'false'}"><div class="ui-modal__header"><h2 class="ui-modal__title" id="${esc(id)}-title">${esc(title)}</h2>${IconButton(
    { label: 'Fechar', icon: 'icon-close', attributes: { 'data-modal-close': true } }
  )}</div><div class="ui-modal__body">${description ? `<p class="ui-modal__description" id="${esc(id)}-desc">${esc(description)}</p>` : ''}${body}</div>${
    footer ? `<div class="ui-modal__footer">${footer}</div>` : ''
  }</dialog>`;
}

// ---------------------------------------------------------------------------------------------
// CONFIRM DIALOG — substituto assíncrono de window.confirm
// ---------------------------------------------------------------------------------------------
let confirmElement = null;
let confirmChain = Promise.resolve();

function ensureConfirmElement() {
  if (confirmElement && document.body.contains(confirmElement)) {
    return confirmElement;
  }

  confirmElement = document.createElement('dialog');
  confirmElement.id = 'confirm-dialog';
  confirmElement.className = 'ui-modal ui-modal--confirm';
  confirmElement.dataset.dismissible = 'false';
  confirmElement.setAttribute('aria-labelledby', 'confirm-dialog-title');
  confirmElement.setAttribute('aria-describedby', 'confirm-dialog-desc');
  confirmElement.setAttribute('closedby', 'closerequest');
  document.body.appendChild(confirmElement);

  return confirmElement;
}

/**
 * Abre o diálogo de confirmação. Resolve `true` (confirmou) ou `false` (cancelou/Esc).
 * - variant "danger": foco inicial no CANCELAR (padrão seguro) e botão de confirmação perigoso.
 * - `requireText`: confirmação reforçada; o botão só age se o usuário digitar o texto exato.
 * - `onConfirm` (opcional, assíncrono): executa com o botão em `loading`; se falhar, o diálogo
 *   permanece aberto mostrando o erro e a promessa só resolve quando o usuário decidir.
 * Chamadas simultâneas são enfileiradas (uma confirmação por vez).
 */
export function confirmDialog(options = {}) {
  const run = () => openConfirm(options);
  const result = confirmChain.then(run, run);

  confirmChain = result.catch(() => false);

  return result;
}

function openConfirm({
  title = 'Confirmar ação',
  description = '',
  details = [],
  warning = '',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  requireText = '',
  onConfirm = null
} = {}) {
  const dialog = ensureConfirmElement();
  const danger = variant === 'danger';
  const detailsHtml = details.length
    ? `<ul class="ui-modal__list">${details.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`
    : '';
  const warningHtml = warning
    ? Alert({ tone: danger ? 'danger' : 'warning', message: warning, className: 'ui-modal__alert' })
    : '';

  dialog.innerHTML = `<form method="dialog" class="ui-modal__form" novalidate><div class="ui-modal__header"><h2 class="ui-modal__title" id="confirm-dialog-title">${esc(title)}</h2></div><div class="ui-modal__body"><p class="ui-modal__description" id="confirm-dialog-desc">${esc(description)}</p>${detailsHtml}${
    warningHtml
  }${
    requireText
      ? `<div class="ui-field"><label class="ui-label" for="confirm-dialog-input">Digite <strong>${esc(requireText)}</strong> para confirmar</label><input class="ui-control" id="confirm-dialog-input" autocomplete="off" aria-describedby="confirm-dialog-error"><p class="ui-error" id="confirm-dialog-error" hidden></p></div>`
      : ''
  }<div id="confirm-dialog-failure" aria-live="assertive"></div></div><div class="ui-modal__footer">${Button(
    {
      label: cancelLabel,
      variant: 'secondary',
      id: 'confirm-dialog-cancel',
      attributes: { 'data-confirm-action': 'cancel' }
    }
  )}${Button({
    label: confirmLabel,
    variant: danger ? 'danger' : 'primary',
    id: 'confirm-dialog-confirm',
    attributes: { 'data-confirm-action': 'confirm' }
  })}</div></form>`;

  return new Promise((resolve) => {
    let decision = false;
    const confirmButton = dialog.querySelector('#confirm-dialog-confirm');
    const cancelButton = dialog.querySelector('#confirm-dialog-cancel');
    const input = dialog.querySelector('#confirm-dialog-input');
    const failure = dialog.querySelector('#confirm-dialog-failure');

    const finish = () => {
      dialog.removeEventListener('close', finish);
      dialog.removeEventListener('click', onClick);
      dialog.removeEventListener('cancel', onCancel);
      resolve(decision);
    };

    const onCancel = () => {
      decision = false;
    };

    const onClick = async (event) => {
      const action = event.target.closest('[data-confirm-action]')?.dataset.confirmAction;

      if (action === 'cancel') {
        decision = false;
        dialog.close();
        return;
      }

      if (action !== 'confirm' || isBusy(confirmButton)) {
        return;
      }

      if (requireText && input.value.trim() !== requireText) {
        const error = dialog.querySelector('#confirm-dialog-error');

        input.setAttribute('aria-invalid', 'true');
        error.textContent = `Digite exatamente "${requireText}" para continuar.`;
        error.hidden = false;
        input.focus();
        return;
      }

      if (onConfirm) {
        setBusy(confirmButton, true);
        failure.innerHTML = '';

        try {
          await onConfirm();
        } catch (error) {
          setBusy(confirmButton, false);
          failure.innerHTML = Alert({
            tone: 'danger',
            title: 'Não foi possível concluir',
            message: error?.message || 'Tente novamente.'
          });
          return;
        }

        setBusy(confirmButton, false);
      }

      decision = true;
      dialog.close();
    };

    dialog.addEventListener('close', finish);
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();

    // Foco inicial seguro: destrutivo -> Cancelar; reforçado -> campo; senão -> confirmar.
    (input || (danger ? cancelButton : confirmButton)).focus();
  });
}

// ---------------------------------------------------------------------------------------------
// DROPDOWN — menu de ações acessível (padrão "menu button" do WAI-ARIA APG)
// ---------------------------------------------------------------------------------------------
const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"]):not(:disabled)';

/**
 * trigger: elemento que abre; panel: contêiner com itens `[role="menuitem"]`.
 * Teclado: Enter/Espaço/↓ abre e foca o primeiro; ↑ abre e foca o último; ↑/↓ movem (com volta),
 * Home/End, Esc fecha e devolve o foco, Tab fecha. Clique fora fecha. Item ativado fecha o menu.
 * O contrato ARIA completo (role="menu") só existe porque todo esse teclado está implementado.
 */
export class Dropdown {
  constructor({ trigger, panel, onClose } = {}) {
    if (!trigger || !panel) {
      throw new Error('Dropdown exige trigger e panel.');
    }

    this.trigger = trigger;
    this.panel = panel;
    this.onClose = onClose;
    this.root = trigger.closest('[data-dropdown]') || trigger.parentElement;

    panel.id ||= uid('menu');
    panel.setAttribute('role', 'menu');
    panel.hidden = true;
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', panel.id);

    // Rótulos de arquivo (<label><input type=file>) também são itens de menu focáveis.
    panel
      .querySelectorAll('label[role="menuitem"]')
      .forEach((label) => label.setAttribute('tabindex', '-1'));

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggle();
    });
    trigger.addEventListener('keydown', (event) => this._onTriggerKey(event));
    panel.addEventListener('keydown', (event) => this._onPanelKey(event));
    panel.addEventListener('click', (event) => {
      if (event.target.closest(ITEM_SELECTOR)) {
        this.close({ restoreFocus: false });
      }
    });
    this._onDocumentClick = (event) => {
      if (this.isOpen() && !this.root.contains(event.target)) {
        this.close({ restoreFocus: false });
      }
    };
    document.addEventListener('click', this._onDocumentClick);
    this.root.addEventListener('focusout', (event) => {
      if (this.isOpen() && event.relatedTarget && !this.root.contains(event.relatedTarget)) {
        this.close({ restoreFocus: false });
      }
    });
  }

  isOpen() {
    return !this.panel.hidden;
  }

  /**
   * Libera o único listener registrado fora do próprio menu (clique fora, no document). Necessário
   * para menus criados a cada renderização de uma lista: sem isto cada render acumularia listeners.
   * Os demais listeners ficam nos elementos do menu e saem com eles.
   */
  dispose() {
    document.removeEventListener('click', this._onDocumentClick);
  }

  items() {
    return [...this.panel.querySelectorAll(ITEM_SELECTOR)].filter(
      (item) => item.offsetParent !== null
    );
  }

  open({ focus = 'first' } = {}) {
    if (this.isOpen()) {
      return;
    }

    this.panel.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this._keepInViewport();

    const items = this.items();
    const target = focus === 'last' ? items[items.length - 1] : items[0];

    target?.focus();
  }

  close({ restoreFocus = true } = {}) {
    if (!this.isOpen()) {
      return;
    }

    this.panel.hidden = true;
    this.panel.removeAttribute('style');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.onClose?.({ restoreFocus });

    if (restoreFocus) {
      this.trigger.focus();
    }
  }

  toggle() {
    if (this.isOpen()) {
      this.close({ restoreFocus: false });
    } else {
      this.open();
    }
  }

  // Resiliência às bordas: desloca na horizontal, inverte para cima quando falta espaço embaixo e,
  // se ainda não couber, limita a altura com rolagem. Só usa estilos inline temporários.
  _keepInViewport() {
    const margin = 8;
    const panel = this.panel;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;

    panel.removeAttribute('style');

    let rect = panel.getBoundingClientRect();

    if (rect.left < margin) {
      panel.style.translate = `${margin - rect.left}px 0`;
    } else if (rect.right > vw - margin) {
      panel.style.translate = `${vw - margin - rect.right}px 0`;
    }

    rect = panel.getBoundingClientRect();

    if (rect.bottom > vh - margin) {
      const triggerRect = this.trigger.getBoundingClientRect();
      const below = vh - margin - triggerRect.bottom;
      const above = triggerRect.top - margin;

      if (above > below) {
        panel.style.top = 'auto';
        panel.style.bottom = '100%';
        panel.style.marginBlock = '0 0.5rem';
        panel.style.maxHeight = `${Math.max(120, above - 8)}px`;
      } else {
        panel.style.maxHeight = `${Math.max(120, below - 8)}px`;
      }

      panel.style.overflowY = 'auto';
    }
  }

  _onTriggerKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.open({ focus: 'first' });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.open({ focus: 'last' });
    } else if (event.key === 'Escape' && this.isOpen()) {
      this.close();
    }
  }

  _onPanelKey(event) {
    const items = this.items();
    const index = items.indexOf(document.activeElement);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'Tab':
        this.close({ restoreFocus: false });
        break;
      case 'Enter':
      case ' ':
        // <label role="menuitem"> não dispara clique por teclado: aciona o controle associado.
        if (document.activeElement?.tagName === 'LABEL') {
          event.preventDefault();
          document.activeElement.click();
        }

        break;
      default:
    }
  }
}
