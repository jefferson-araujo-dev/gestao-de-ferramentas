/**
 * Política do Toast (Gate 1-E) — funções puras, testáveis sem navegador.
 *
 * - success/info: informativos, somem sozinhos. warning/error: precisam de tempo para serem lidos
 *   (WCAG 2.2.1: temporização ajustável) e por isso têm mínimos maiores; erros nunca somem rápido.
 * - O tempo cresce com o tamanho da mensagem (leitura) e pode ser suspenso (hover/foco) no toast.
 * - `persistent` (ou duration Infinity) exige fechar manualmente.
 * - Erros e avisos usam role="alert" (assertivo); sucesso/info usam role="status" (educado).
 */
export const TOAST_TYPES = Object.freeze(['success', 'info', 'warning', 'error', 'progress']);

const BASE = Object.freeze({
  success: 4000,
  info: 5000,
  warning: 8000,
  error: 12000,
  progress: Infinity
});
const MAX = 20000;

export function toastDuration(type, message = '', { duration, persistent = false } = {}) {
  if (persistent || duration === Infinity || BASE[type] === Infinity) {
    return Infinity;
  }

  const base = BASE[type] ?? BASE.info;
  const words = String(message).trim().split(/\s+/).filter(Boolean).length;
  const reading = 2000 + words * 300;
  const computed = Math.min(MAX, Math.max(base, reading));

  if (typeof duration === 'number') {
    // Chamador pode pedir mais tempo, nunca menos que o mínimo do tipo (erros/avisos protegidos).
    return Math.min(MAX, Math.max(duration, type === 'error' || type === 'warning' ? base : 0));
  }

  return computed;
}

export const toastRole = (type) => (type === 'error' || type === 'warning' ? 'alert' : 'status');

export const TOAST_LABELS = Object.freeze({
  success: 'Sucesso',
  info: 'Informação',
  warning: 'Atenção',
  error: 'Erro',
  progress: 'Em andamento'
});
