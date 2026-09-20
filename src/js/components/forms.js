import { attrs, cx, esc, icon, uid } from './util.js';

/**
 * Controles de formulário (Gate 1-E): Input, Select, Search, Checkbox e Switch.
 *
 * Contrato comum: altura, raio, borda de controle (>= 3:1), tipografia, foco (foundation 1-C),
 * disabled, invalid e texto de ajuda/erro. O RÓTULO é obrigatório e associado programaticamente
 * (`label[for]`); placeholder nunca substitui rótulo. Em barras de filtro pode-se omitir o rótulo
 * visível com `hideLabel` (continua no DOM, visualmente oculto, como nome acessível).
 */
function labelHtml(id, label, { hideLabel = false, required = false } = {}) {
  return `<label class="${cx('ui-label', hideLabel && 'ui-sr-only')}" for="${esc(id)}">${esc(label)}${
    required ? '<span class="ui-required" aria-hidden="true"> *</span>' : ''
  }</label>`;
}

// Ajuda e erro ficam SEMPRE no DOM (o erro só aparece quando o campo é inválido) e são ligados ao
// controle por aria-describedby, para o leitor de tela ler a mensagem junto do campo.
function messagesHtml(id, { help, error }) {
  return `${help ? `<p class="ui-help" id="${esc(id)}-help">${esc(help)}</p>` : ''}<p class="ui-error" id="${esc(id)}-error" ${
    error ? '' : 'hidden'
  }>${esc(error ?? '')}</p>`;
}

function describedBy(id, { help }) {
  return [help ? `${id}-help` : '', `${id}-error`].filter(Boolean).join(' ');
}

function requireLabel(label, kind) {
  if (!label || !String(label).trim()) {
    throw new Error(`${kind} exige "label" (rótulo associado).`);
  }
}

export function Input({
  className = '',
  label,
  id = uid('input'),
  name,
  type = 'text',
  value = '',
  placeholder,
  help,
  error,
  required = false,
  disabled = false,
  hideLabel = false,
  autocomplete,
  inputmode,
  attributes = {}
} = {}) {
  requireLabel(label, 'Input');

  return `<div class="${cx('ui-field', error && 'is-invalid', className)}">${labelHtml(id, label, { hideLabel, required })}<input class="ui-control" id="${esc(id)}" type="${esc(type)}"${attrs(
    {
      name,
      value: value === '' ? undefined : value,
      placeholder,
      required,
      disabled,
      autocomplete,
      inputmode,
      'aria-invalid': error ? 'true' : undefined,
      'aria-describedby': describedBy(id, { help, error }),
      ...attributes
    }
  )}>${messagesHtml(id, { help, error })}</div>`;
}

/** options: [{ value, label, selected?, disabled? }] */
export function Select({
  className = '',
  label,
  id = uid('select'),
  name,
  options = [],
  help,
  error,
  required = false,
  disabled = false,
  hideLabel = false,
  attributes = {}
} = {}) {
  requireLabel(label, 'Select');

  const optionsHtml = options
    .map(
      (o) =>
        `<option value="${esc(o.value)}"${attrs({ selected: o.selected, disabled: o.disabled })}>${esc(o.label)}</option>`
    )
    .join('');

  return `<div class="${cx('ui-field', error && 'is-invalid', className)}">${labelHtml(id, label, { hideLabel, required })}<div class="ui-select"><select class="ui-control" id="${esc(id)}"${attrs(
    {
      name,
      required,
      disabled,
      'aria-invalid': error ? 'true' : undefined,
      'aria-describedby': describedBy(id, { help, error }),
      ...attributes
    }
  )}>${optionsHtml}</select>${icon('icon-chevron-down', 'ui-select__chevron')}</div>${messagesHtml(id, { help, error })}</div>`;
}

/** Busca: type=search com ícone decorativo; o rótulo é o nome acessível (pode ficar oculto). */
export function Search({
  className = '',
  label = 'Buscar',
  id = uid('search'),
  name,
  value = '',
  placeholder,
  disabled = false,
  hideLabel = true,
  attributes = {}
} = {}) {
  requireLabel(label, 'Search');

  return `<div class="${cx('ui-field', 'ui-search', className)}" role="search">${labelHtml(id, label, { hideLabel })}<div class="ui-search__box">${icon('icon-search', 'ui-search__icon')}<input class="ui-control ui-search__input" id="${esc(id)}" type="search" autocomplete="off"${attrs(
    { name, value: value === '' ? undefined : value, placeholder, disabled, ...attributes }
  )}></div></div>`;
}

export function Checkbox({
  label,
  id = uid('check'),
  name,
  checked = false,
  disabled = false,
  help,
  attributes = {}
} = {}) {
  requireLabel(label, 'Checkbox');

  return `<div class="ui-check"><input class="ui-check__input" type="checkbox" id="${esc(id)}"${attrs(
    { name, checked, disabled, 'aria-describedby': help ? `${id}-help` : undefined, ...attributes }
  )}><label class="ui-check__label" for="${esc(id)}">${esc(label)}</label>${
    help ? `<p class="ui-help" id="${esc(id)}-help">${esc(help)}</p>` : ''
  }</div>`;
}

/**
 * Switch = checkbox com role="switch" (teclado nativo: Espaço; estado anunciado como ligado/desligado).
 * O estado NÃO depende só de cor: a posição do botão dentro da trilha muda e o rótulo é sempre visível.
 */
export function Switch({
  label,
  id = uid('switch'),
  name,
  checked = false,
  disabled = false,
  attributes = {}
} = {}) {
  requireLabel(label, 'Switch');

  return `<div class="ui-switch"><input class="ui-switch__input" type="checkbox" role="switch" id="${esc(id)}"${attrs(
    { name, checked, disabled, ...attributes }
  )}><span class="ui-switch__track" aria-hidden="true"><span class="ui-switch__thumb"></span></span><label class="ui-switch__label" for="${esc(id)}">${esc(label)}</label></div>`;
}

/**
 * Ponte visual <-> acessibilidade (guia "accessible-error-announcement"): aplica aria-invalid e
 * revela a mensagem de erro só DEPOIS da interação do usuário (:user-invalid), nunca no carregamento.
 * Delegação no `root`; retorna a função de remoção.
 */
export function bindFieldValidation(root = document) {
  const sync = (event) => {
    const control = event.target;

    if (!control.matches?.('.ui-control, .ui-check__input')) {
      return;
    }

    const invalid = control.matches(':user-invalid');
    const error = document.getElementById(`${control.id}-error`);

    control.setAttribute('aria-invalid', String(invalid));
    control.closest('.ui-field')?.classList.toggle('is-invalid', invalid);

    if (error) {
      if (invalid) {
        error.textContent = error.dataset.message || control.validationMessage;
      }

      error.hidden = !invalid;
    }
  };

  root.addEventListener('blur', sync, true);
  root.addEventListener('input', sync, true);
  root.addEventListener('change', sync, true);

  return () => {
    root.removeEventListener('blur', sync, true);
    root.removeEventListener('input', sync, true);
    root.removeEventListener('change', sync, true);
  };
}
