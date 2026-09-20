/**
 * AdvancedUtils - Utilitários avançados com funções auxiliares profissionais
 */

import { CONFIG } from '../config/constants.js';
import { formatDateTime } from './dateFormat.js';

/**
 * Debounce avançado com cancelamento e leading edge
 */
export function debounce(func, wait = CONFIG.DEBOUNCE_DELAY, options = {}) {
  let timeout;
  let lastArgs;
  let lastThis;
  let lastResult;
  let lastCallTime = 0;

  const { leading = false, maxWait = null } = options;

  function invokeFunc(time) {
    const args = lastArgs;
    const thisArg = lastThis;
    lastArgs = lastThis = undefined;
    lastCallTime = time;
    lastResult = func.apply(thisArg, args);
    return lastResult;
  }

  function debounced(...args) {
    const time = Date.now();
    lastArgs = args;
    lastThis = this;

    const isLeadingCall = leading && !timeout;

    if (timeout) {
      clearTimeout(timeout);
    }

    if (maxWait && lastCallTime && time - lastCallTime >= maxWait) {
      invokeFunc(time);
    }

    timeout = setTimeout(() => {
      timeout = null;
      if (!leading) {
        invokeFunc(Date.now());
      }
    }, wait);

    if (isLeadingCall) {
      invokeFunc(time);
    }

    return lastResult;
  }

  debounced.cancel = function () {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = lastArgs = lastThis = undefined;
    lastCallTime = 0;
  };

  debounced.flush = function () {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
      return invokeFunc(Date.now());
    }
    return lastResult;
  };

  return debounced;
}

/**
 * Throttle avançado com opções
 */
export function throttle(func, wait = CONFIG.DEBOUNCE_DELAY, options = {}) {
  let timeout = null;
  let lastArgs = null;
  let lastThis = null;
  let lastCallTime = 0;
  let lastResult = null;

  const { leading = true, trailing = true } = options;

  function invokeFunc(time) {
    const args = lastArgs;
    const thisArg = lastThis;
    lastArgs = lastThis = undefined;
    lastCallTime = time;
    lastResult = func.apply(thisArg, args);
    return lastResult;
  }

  function throttled(...args) {
    const time = Date.now();
    lastArgs = args;
    lastThis = this;

    if (lastCallTime === 0 && !leading) {
      lastCallTime = time;
    }

    const remaining = wait - (time - lastCallTime);

    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      invokeFunc(time);
    } else if (!timeout && trailing) {
      timeout = setTimeout(() => {
        lastCallTime = leading === false ? 0 : Date.now();
        timeout = null;
        invokeFunc(Date.now());
      }, remaining);
    }

    return lastResult;
  }

  throttled.cancel = function () {
    clearTimeout(timeout);
    lastCallTime = 0;
    timeout = lastArgs = lastThis = undefined;
  };

  return throttled;
}

/**
 * Cria um retry exponential para operações assíncronas
 */
export async function retry(fn, options = {}) {
  const { times = 3, delay = 1000, maxDelay = 10000, factor = 2, onRetry = null } = options;

  let lastError;

  for (let attempt = 1; attempt <= times; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      if (attempt === times) {
        throw error;
      }

      if (onRetry) {
        onRetry(error, attempt, times);
      }

      // Exponential backoff com jitter
      const exponentialDelay = Math.min(maxDelay, delay * Math.pow(factor, attempt - 1));
      const jitter = exponentialDelay * 0.1 * Math.random();
      const waitTime = exponentialDelay + jitter;

      console.warn(
        `[Retry] Tentativa ${attempt} falhou. Tentando novamente em ${Math.round(waitTime)}ms...`
      );
      await sleep(waitTime);
    }
  }

  throw lastError;
}

/**
 * Sleep async
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Timeout para promises
 */
export async function withTimeout(
  promise,
  ms = CONFIG.TIMEOUT_MS,
  errorMessage = 'Timeout excedido'
) {
  let timeoutHandle;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(errorMessage));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Pipe para composição de funções
 */
export function pipe(...functions) {
  return (initialValue) => {
    return functions.reduce((value, fn) => fn(value), initialValue);
  };
}

/**
 * Compose para composição de funções (direita para esquerda)
 */
export function compose(...functions) {
  return (initialValue) => {
    return functions.reduceRight((value, fn) => fn(value), initialValue);
  };
}

/**
 * Memoize para cache de resultados de funções
 */
export function memoize(fn, options = {}) {
  const cache = new Map();
  const maxSize = options.maxSize || 1000;

  return function (...args) {
    const key = options.keyResolver ? options.keyResolver(...args) : JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key);
    }

    if (cache.size >= maxSize) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }

    const result = fn.apply(this, args);
    cache.set(key, result);
    return result;
  };
}

/**
 * Deep clone de objetos
 */
export function deepClone(obj, hash = new WeakMap()) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags);
  }
  if (obj instanceof Map) {
    return new Map(obj);
  }
  if (obj instanceof Set) {
    return new Set(obj);
  }
  if (hash.has(obj)) {
    return hash.get(obj);
  }

  const clone = Array.isArray(obj) ? [] : {};
  hash.set(obj, clone);

  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key], hash);
  }

  return clone;
}

/**
 * Deep merge de objetos
 */
export function deepMerge(target, source) {
  const output = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] instanceof Object && key in target) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }

  return output;
}

/**
 * Obtém valor de objeto aninhado por path
 */
export function get(object, path, defaultValue = undefined) {
  const keys = Array.isArray(path) ? path : path.split('.');
  let result = object;

  for (const key of keys) {
    if (result === null || result === undefined) {
      return defaultValue;
    }
    result = result[key];
  }

  return result === undefined ? defaultValue : result;
}

/**
 * Define valor de objeto aninhado por path
 */
export function set(object, path, value) {
  const keys = Array.isArray(path) ? path : path.split('.');
  let current = object;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
  return object;
}

/**
 * Formata bytes para string legível
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) {
    return '0 Bytes';
  }

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Formata data relativa (ex: "há 5 minutos")
 */
export function formatRelativeDate(date) {
  const now = new Date();
  const target = new Date(date);
  const seconds = Math.floor((now - target) / 1000);

  const intervals = [
    { label: 'ano', seconds: 31536000 },
    { label: 'mês', seconds: 2592000 },
    { label: 'semana', seconds: 604800 },
    { label: 'dia', seconds: 86400 },
    { label: 'hora', seconds: 3600 },
    { label: 'minuto', seconds: 60 }
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      if (interval.label === 'mês') {
        return `há ${count} ${count > 1 ? 'meses' : 'mês'}`;
      }
      return `há ${count} ${interval.label}${count > 1 ? 's' : ''}`;
    }
  }

  return 'agora mesmo';
}

/**
 * Gera ID único
 */
export function generateId(prefix = '') {
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 11)}`;
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Remove acentos de string
 */
export function removeAccents(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Escape HTML para segurança
 */
export function escapeHTML(str) {
  return String(str || '').replace(
    /[&<>'"]/g,
    (match) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      })[match]
  );
}

/**
 * Padroniza código/patrimônio
 */
export function normalizeCode(code) {
  return removeAccents(
    String(code || '')
      .toUpperCase()
      .trim()
  );
}

/**
 * Formata moeda brasileira
 */
export function formatCurrency(value, locale = 'pt-BR', currency = 'BRL') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency
  }).format(value);
}

/**
 * Formata número com separadores brasileiros
 */
export function formatNumber(value, decimals = 2) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

/**
 * Formata porcentagem
 */
export function formatPercentage(value, total, decimals = 0) {
  if (total === 0) {
    return '0%';
  }
  return `${((value / total) * 100).toFixed(decimals)}%`;
}

/**
 * Trunca string
 */
export function truncate(str, maxLength, suffix = '...') {
  if (!str || str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Capitaliza primeira letra de cada palavra
 */
export function titleCase(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (match) => match.toUpperCase());
}

/**
 * Gera iniciais de um nome
 */
export function getInitials(name, maxChars = 2) {
  if (!name) {
    return '';
  }

  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, maxChars).toUpperCase();
  }

  return parts
    .slice(0, maxChars)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/**
 * Agrupa array por chave
 */
export function groupBy(array, key) {
  return array.reduce((result, item) => {
    const groupKey = typeof key === 'function' ? key(item) : item[key];
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
    return result;
  }, {});
}

/**
 * Ordena array por múltiplas chaves
 */
export function orderBy(array, keys, orders = []) {
  return [...array].sort((a, b) => {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const order = orders[i] || 'asc';

      const valueA = typeof key === 'function' ? key(a) : a[key];
      const valueB = typeof key === 'function' ? key(b) : b[key];

      const comparison = String(valueA).localeCompare(String(valueB), 'pt-BR');

      if (comparison !== 0) {
        return order === 'desc' ? -comparison : comparison;
      }
    }
    return 0;
  });
}

/**
 * Remove duplicatas por chave
 */
export function uniqBy(array, key) {
  const seen = new Set();
  return array.filter((item) => {
    const value = typeof key === 'function' ? key(item) : item[key];
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

/**
 * Chunk array
 */
export function chunk(array, size = 1) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Carrega script dinamicamente com cache
 */
const scriptCache = new Set();

export async function loadScript(src) {
  if (scriptCache.has(src)) {
    return;
  }
  if (document.querySelector(`script[src="${src}"]`)) {
    scriptCache.add(src);
    return;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
      scriptCache.add(src);
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/**
 * Intersection Observer helper
 */
export function observeIntersection(element, callback, options = {}) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          callback(entry);
        }
      });
    },
    {
      threshold: 0.1,
      rootMargin: '0px',
      ...options
    }
  );

  observer.observe(element);

  return () => {
    observer.unobserve(element);
    observer.disconnect();
  };
}

/**
 * Virtual list helper para renderização otimizada
 */
export class VirtualList {
  constructor(container, options = {}) {
    this.container = container;
    this.itemHeight = options.itemHeight || 100;
    this.buffer = options.buffer || 5;
    this.items = [];
    this.renderFn = options.render;
    this.scrollTop = 0;

    this._onScroll = this._onScroll.bind(this);
    container.addEventListener('scroll', this._onScroll);
  }

  setItems(items) {
    this.items = items;
    this._render();
  }

  _onScroll() {
    this.scrollTop = this.container.scrollTop;
    this._render();
  }

  _render() {
    const visibleStart = Math.floor(this.scrollTop / this.itemHeight);
    const visibleCount = Math.ceil(this.container.clientHeight / this.itemHeight);
    const start = Math.max(0, visibleStart - this.buffer);
    const end = Math.min(this.items.length, visibleStart + visibleCount + this.buffer);

    const fragment = document.createDocumentFragment();
    this.container.innerHTML = '';

    // Spacer top
    const topSpacer = document.createElement('div');
    topSpacer.style.height = `${start * this.itemHeight}px`;
    this.container.appendChild(topSpacer);

    // Items visíveis
    for (let i = start; i < end; i++) {
      const item = this.items[i];
      const element = this.renderFn(item, i);
      fragment.appendChild(element);
    }
    this.container.appendChild(fragment);

    // Spacer bottom
    const bottomHeight = (this.items.length - end) * this.itemHeight;
    if (bottomHeight > 0) {
      const bottomSpacer = document.createElement('div');
      bottomSpacer.style.height = `${bottomHeight}px`;
      this.container.appendChild(bottomSpacer);
    }
  }

  destroy() {
    this.container.removeEventListener('scroll', this._onScroll);
    this.items = [];
    this.container.innerHTML = '';
  }
}

/**
 * Extrai mensagem de erro amigável (Firebase)
 */
export function getErrorMessage(err) {
  const code = String(err?.code || '').toLowerCase();
  if (code.includes('permission-denied')) {
    return 'O Firestore recusou a operação por permissão.';
  }
  if (code.includes('unauthenticated')) {
    return 'Sua sessão expirou. Faça login novamente.';
  }
  if (code.includes('unavailable')) {
    return 'O banco de dados está indisponível no momento.';
  }
  const message = String(err?.message || '').trim();
  return message.length > 140 ? `${message.slice(0, 137)}...` : message;
}

/**
 * Formata Firestore Timestamp, Date, ISO ou milissegundos para Data/Hora local
 */
export function formatDate(value) {
  return formatDateTime(value, { fallback: 'Sem registro', includeSeconds: false });
}

/**
 * Comprime imagem para Base64
 */
export function compressImageToBase64(
  file,
  maxWidth = CONFIG.IMAGE_MAX_WIDTH || 500,
  quality = CONFIG.IMAGE_QUALITY || 0.6
) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.readAsDataURL(file);
    r.onload = (e) => {
      const i = new Image();
      i.src = e.target.result;
      i.onload = () => {
        const cv = document.createElement('canvas');
        let w = i.width,
          h = i.height;
        if (w > h && w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        } else if (h > maxWidth) {
          w = Math.round((w * maxWidth) / h);
          h = maxWidth;
        }
        cv.width = w;
        cv.height = h;
        cv.getContext('2d').drawImage(i, 0, 0, w, h);
        res(cv.toDataURL('image/jpeg', quality));
      };
      i.onerror = rej;
    };
    r.onerror = rej;
  });
}

export function getBadgeHTML(s) {
  const b = {
    available:
      'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-800/50 dark:text-emerald-400',
    borrowed:
      'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800/50 dark:text-amber-400',
    maintenance:
      'text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-900/30 dark:border-rose-800/50 dark:text-rose-400',
    in: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400',
    out: 'text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400'
  };
  const txt = {
    available: 'Disponível',
    borrowed: 'Emprestada',
    maintenance: 'Manutenção',
    in: 'Devolução',
    out: 'Retirada'
  };
  return `<span class="inline-flex items-center gap-1 px-2.5 py-1 border rounded-lg text-[10px] font-extrabold tracking-widest uppercase shadow-sm ${b[s] || 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}">${txt[s] || s}</span>`;
}

export function getSkeletonHTML() {
  return '<div class="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 animate-pulse flex flex-col gap-4"><div class="flex gap-4"><div class="w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-xl"></div><div class="flex-1"><div class="h-4 bg-slate-200 dark:bg-slate-700 w-3/4 rounded mb-2"></div><div class="h-3 bg-slate-200 dark:bg-slate-700 w-1/2 rounded"></div></div></div><div class="border-t border-slate-100 dark:border-slate-800"></div><div class="h-3 bg-slate-200 dark:bg-slate-700 w-full rounded"></div></div>';
}

export function getEmptyStateHTML(msg) {
  return `<div class="col-span-full p-12 flex flex-col items-center justify-center text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800"><div class="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-8 h-8 text-slate-400"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div><p class="text-slate-500 dark:text-slate-400 font-medium">${msg}</p></div>`;
}

export const Logger = {
  error: (msg, err) => {
    const detail = getErrorMessage(err);
    console.error(`[ERRO] ${msg}`, err || '');
    if (window.App && window.App.UI) {
      window.App.UI.showToast(detail ? `${msg} ${detail}` : msg, 'error');
    }
  },
  warn: (msg, data) => console.warn(`[AVISO] ${msg}`, data || ''),
  info: (msg, data) => console.info(`[INFO] ${msg}`, data || '')
};

export const AudioSys = {
  ctx: null,
  playBeep: function (type = 'success') {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const o = this.ctx.createOscillator(),
        g = this.ctx.createGain();
      o.connect(g);
      g.connect(this.ctx.destination);
      if (type === 'success') {
        o.type = 'sine';
        o.frequency.setValueAtTime(880, this.ctx.currentTime);
        g.gain.setValueAtTime(0.1, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
        o.start();
        o.stop(this.ctx.currentTime + 0.1);
      } else {
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(150, this.ctx.currentTime);
        g.gain.setValueAtTime(0.1, this.ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
        o.start();
        o.stop(this.ctx.currentTime + 0.3);
      }
    } catch (e) {
      Logger.warn('Erro ao reproduzir som:', e?.message);
    }
  }
};
