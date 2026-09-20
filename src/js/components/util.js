/**
 * Utilitários compartilhados pelos componentes (Gate 1-E).
 *
 * Os componentes são funções que devolvem HTML (string) sobre classes `ui-*` de
 * src/css/components.css, mais pequenos controladores de comportamento. Vanilla JS, sem biblioteca.
 * Todo texto dinâmico passa por `esc`; ícones vêm do sprite SVG da página (`#icon-*`).
 */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Junta classes ignorando valores vazios.
export const cx = (...parts) => parts.filter(Boolean).join(' ');

// Atributos HTML seguros: { 'data-x': 'a', disabled: true, hidden: false } -> ' data-x="a" disabled'.
export function attrs(map = {}) {
  return Object.entries(map)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${esc(value)}"`))
    .join('');
}

// Ícone decorativo do sprite: sempre aria-hidden (o significado vem do texto/aria-label do pai).
export function icon(id, className = 'ui-icon') {
  return `<svg class="${esc(className)}" aria-hidden="true" focusable="false"><use href="#${esc(id)}"></use></svg>`;
}

let counter = 0;

// Identificador único para associar label/descrição/erro.
export const uid = (prefix = 'ui') => {
  counter += 1;

  return `${prefix}-${counter}`;
};
