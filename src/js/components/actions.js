import { attrs, cx, esc, icon } from './util.js';

/**
 * Button e IconButton (Gate 1-E).
 *
 * Variantes semânticas: primary | secondary | ghost | danger.
 * Estados: default, hover, active, focus-visible (foundation 1-C), disabled e loading
 * (`setBusy`). Sem `!important` e sem cor fixa: tudo vem de tokens em components.css.
 */
export const BUTTON_VARIANTS = Object.freeze(['primary', 'secondary', 'ghost', 'danger']);
export const BUTTON_SIZES = Object.freeze(['md', 'sm']);

function assertVariant(variant) {
  if (!BUTTON_VARIANTS.includes(variant)) {
    throw new Error(`Variante de botão inválida: "${variant}"`);
  }
}

/**
 * @param {object} o
 * @param {string} o.label      texto visível (obrigatório)
 * @param {string} [o.variant]  primary | secondary | ghost | danger
 * @param {string} [o.size]     md | sm
 * @param {string} [o.icon]     id do sprite (ícone antes do texto, decorativo)
 * @param {boolean} [o.block]   ocupa toda a largura
 * @param {string} [o.type]     button (padrão) | submit | reset
 */
export function Button({
  label,
  variant = 'secondary',
  size = 'md',
  icon: iconId,
  block = false,
  type = 'button',
  disabled = false,
  id,
  className = '',
  attributes = {}
} = {}) {
  if (!label) {
    throw new Error('Button exige "label".');
  }

  assertVariant(variant);

  const classes = cx(
    'ui-btn',
    `ui-btn--${variant}`,
    size === 'sm' && 'ui-btn--sm',
    block && 'ui-btn--block',
    className
  );

  return `<button type="${esc(type)}" class="${classes}"${attrs({ id, disabled, ...attributes })}>${
    iconId ? icon(iconId, 'ui-btn__icon') : ''
  }<span class="ui-btn__label">${esc(label)}</span></button>`;
}

/**
 * Botão só com ícone: o nome acessível (`label`) é OBRIGATÓRIO e o ícone é decorativo.
 * Alvo de toque de 44px em ponteiro grosso (components.css).
 */
export function IconButton({
  label,
  icon: iconId,
  variant = 'ghost',
  type = 'button',
  disabled = false,
  id,
  className = '',
  attributes = {}
} = {}) {
  if (!label || !String(label).trim()) {
    throw new Error('IconButton exige "label" (nome acessível).');
  }

  if (!iconId) {
    throw new Error('IconButton exige "icon".');
  }

  assertVariant(variant);

  return `<button type="${esc(type)}" class="${cx('ui-icon-btn', `ui-icon-btn--${variant}`, className)}" aria-label="${esc(label)}"${attrs(
    { id, disabled, ...attributes }
  )}>${icon(iconId, 'ui-icon')}</button>`;
}

/**
 * Estado de carregamento de um botão já no DOM. Mantém o texto (sem mudar largura), mostra o
 * indicador e anuncia o estado (`aria-busy` + `aria-disabled`). NÃO usa `disabled`, para o foco não
 * se perder no meio de uma operação; cliques do ponteiro são bloqueados por CSS e quem trata o
 * clique deve conferir `isBusy(button)` (teclado). Idempotente.
 */
export function setBusy(button, busy = true) {
  if (!button) {
    return;
  }

  button.classList.toggle('is-loading', busy);

  if (busy) {
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-disabled', 'true');
  } else {
    button.removeAttribute('aria-busy');
    button.removeAttribute('aria-disabled');
  }
}

export const isBusy = (button) => button?.hasAttribute('aria-busy') === true;
