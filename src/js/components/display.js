import { attrs, cx, esc, icon } from './util.js';

/**
 * Componentes de exibição (Gate 1-E): Badge, StatusBadge, Card, StatCard, Alert, EmptyState e
 * Skeleton. Cores só por tokens (components.css); o significado NUNCA depende só de cor: todo
 * badge/alerta tem texto, e Alert/StatusBadge repetem o estado em palavras.
 */
export const TONES = Object.freeze(['neutral', 'info', 'success', 'warning', 'danger']);

function assertTone(tone) {
  if (!TONES.includes(tone)) {
    throw new Error(`Tom inválido: "${tone}"`);
  }
}

export function Badge({ label, tone = 'neutral', className = '', attributes = {} } = {}) {
  if (!label) {
    throw new Error('Badge exige "label".');
  }

  assertTone(tone);

  return `<span class="${cx('ui-badge', `ui-badge--${tone}`, className)}"${attrs(attributes)}>${esc(label)}</span>`;
}

// Estados de ferramenta/movimentação -> texto + tom. O texto vem SEMPRE (o tom é reforço).
export const STATUS_MAP = Object.freeze({
  available: { label: 'Disponível', tone: 'success' },
  borrowed: { label: 'Emprestada', tone: 'warning' },
  maintenance: { label: 'Manutenção', tone: 'danger' },
  in: { label: 'Devolução', tone: 'success' },
  out: { label: 'Retirada', tone: 'info' }
});

/** Compatível com o antigo getBadgeHTML(status): status desconhecido vira badge neutro com o texto. */
export function StatusBadge(status, { className = '' } = {}) {
  const known = STATUS_MAP[status];
  const label = known ? known.label : String(status ?? '');

  return `<span class="${cx('ui-badge', 'ui-badge--status', `ui-badge--${known ? known.tone : 'neutral'}`, className)}" data-status="${esc(status)}"><span class="ui-badge__dot" aria-hidden="true"></span>${esc(label)}</span>`;
}

export function Card({
  body = '',
  header = '',
  footer = '',
  interactive = false,
  className = '',
  tag = 'div',
  attributes = {}
} = {}) {
  return `<${tag} class="${cx('ui-card', interactive && 'ui-card--interactive', className)}"${attrs(attributes)}>${
    header ? `<div class="ui-card__header">${header}</div>` : ''
  }<div class="ui-card__body">${body}</div>${footer ? `<div class="ui-card__footer">${footer}</div>` : ''}</${tag}>`;
}

/**
 * Indicador (KPI): valor, rótulo e informação auxiliar opcional. `valueId` preserva o elemento que
 * o JS existente atualiza por id. Com `interactive` vira <button> (teclado/foco) em vez de <div>.
 * Números tabulares (alinham dígitos).
 */
export function StatCard({
  label,
  value = '0',
  valueId,
  meta,
  metaIcon,
  icon: iconId,
  tone = 'neutral',
  interactive = false,
  attributes = {},
  className = ''
} = {}) {
  if (!label) {
    throw new Error('StatCard exige "label".');
  }

  assertTone(tone);

  const tag = interactive ? 'button' : 'div';
  const typeAttr = interactive ? ' type="button"' : '';

  return `<${tag}${typeAttr} class="${cx('ui-card', 'ui-stat', tone !== 'neutral' && `ui-stat--${tone}`, interactive && 'ui-card--interactive ui-stat--interactive', className)}"${attrs(attributes)}>${
    iconId ? `<span class="ui-stat__icon" aria-hidden="true">${icon(iconId, 'ui-icon')}</span>` : ''
  }<span class="ui-stat__value stat-number"${attrs({ id: valueId })}>${esc(value)}</span><span class="ui-stat__label">${esc(label)}</span>${
    meta
      ? `<span class="ui-stat__meta">${metaIcon ? icon(metaIcon, 'ui-icon ui-icon--xs') : ''}<span>${esc(meta)}</span></span>`
      : ''
  }</${tag}>`;
}

const ALERT_ICONS = Object.freeze({
  info: 'icon-info',
  success: 'icon-check-circle',
  warning: 'icon-alert-triangle',
  danger: 'icon-x-circle',
  neutral: 'icon-info'
});

/**
 * Aviso persistente na página. warning/danger usam role="alert" (assertivo); info/success usam
 * role="status" (educado). Ícone + título/texto: nunca só cor.
 */
export function Alert({
  tone = 'info',
  title,
  message = '',
  id,
  className = '',
  actions = ''
} = {}) {
  assertTone(tone);

  if (!title && !message) {
    throw new Error('Alert exige "title" ou "message".');
  }

  const role = tone === 'danger' || tone === 'warning' ? 'alert' : 'status';

  return `<div class="${cx('ui-alert', `ui-alert--${tone}`, className)}" role="${role}"${attrs({ id })}>${icon(ALERT_ICONS[tone], 'ui-alert__icon')}<div class="ui-alert__content">${
    title ? `<p class="ui-alert__title">${esc(title)}</p>` : ''
  }${message ? `<p class="ui-alert__message">${esc(message)}</p>` : ''}${actions}</div></div>`;
}

/** Estado vazio: título obrigatório; descrição, ícone e ação (HTML de um Button) opcionais. */
export function EmptyState({
  title,
  description = '',
  icon: iconId = 'icon-inbox',
  action = '',
  className = '',
  attributes = {}
} = {}) {
  if (!title) {
    throw new Error('EmptyState exige "title".');
  }

  return `<div class="${cx('ui-empty', className)}"${attrs(attributes)}><div class="ui-empty__icon" aria-hidden="true">${icon(iconId, 'ui-icon ui-icon--lg')}</div><p class="ui-empty__title">${esc(title)}</p>${
    description ? `<p class="ui-empty__description">${esc(description)}</p>` : ''
  }${action ? `<div class="ui-empty__action">${action}</div>` : ''}</div>`;
}

/** Bloco de carregamento com dimensões previsíveis. Decorativo (aria-hidden); sem animação obrigatória. */
export function Skeleton({ width = '100%', height = '1rem', className = '' } = {}) {
  return `<span class="${cx('ui-skeleton', className)}" style="width:${esc(width)};height:${esc(height)}" aria-hidden="true"></span>`;
}

/** Cartão de ferramenta em carregamento (mesma altura aproximada do cartão real). */
export function SkeletonCard() {
  return `<div class="ui-card ui-skeleton-card" aria-hidden="true"><div class="ui-skeleton-card__row">${Skeleton({ width: '3rem', height: '3rem', className: 'ui-skeleton--rounded' })}<div class="ui-skeleton-card__lines">${Skeleton({ width: '75%', height: '1rem' })}${Skeleton({ width: '50%', height: '0.75rem' })}</div></div>${Skeleton({ width: '100%', height: '0.75rem' })}</div>`;
}
