/**
 * dateFormat - Conversão e formatação de datas sem dependências.
 *
 * Aceita os formatos que os documentos do Firestore podem conter:
 * Timestamp (com toDate()), objeto { seconds, nanoseconds }, Date,
 * string ISO e milissegundos numéricos.
 */

const LOCALE = 'pt-BR';
const MS_PER_SECOND = 1000;
const NANOS_PER_MS = 1e6;
const DATE_PARTS = { day: '2-digit', month: '2-digit', year: 'numeric' };
const TIME_PARTS = { hour: '2-digit', minute: '2-digit' };

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function toValidDateOrNull(date) {
  return isValidDate(date) ? date : null;
}

/**
 * Converte um valor de data em Date válido, ou null quando não for possível.
 * Nunca lança erro.
 */
export function toValidDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return toValidDateOrNull(value);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? toValidDateOrNull(new Date(value)) : null;
  }

  if (typeof value === 'string') {
    return toValidDateOrNull(new Date(value));
  }

  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try {
        return toValidDateOrNull(value.toDate());
      } catch {
        return null;
      }
    }

    if (typeof value.seconds === 'number' && Number.isFinite(value.seconds)) {
      const nanoseconds =
        typeof value.nanoseconds === 'number' && Number.isFinite(value.nanoseconds)
          ? value.nanoseconds
          : 0;

      return toValidDateOrNull(
        new Date(value.seconds * MS_PER_SECOND + Math.floor(nanoseconds / NANOS_PER_MS))
      );
    }
  }

  return null;
}

/**
 * Formata uma data em pt-BR (fuso local do ambiente).
 * Retorna `fallback` quando o valor for ausente ou inválido.
 */
export function formatDateTime(value, { fallback = '-', includeSeconds = true } = {}) {
  const date = toValidDate(value);

  if (!date) {
    return fallback;
  }

  const options = { ...DATE_PARTS, ...TIME_PARTS };

  if (includeSeconds) {
    options.second = '2-digit';
  }

  return date.toLocaleString(LOCALE, options);
}
