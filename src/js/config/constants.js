/**
 * @typedef {Object} AppConfig
 * @property {string} APP_ID - Identificador único da aplicação
 * @property {number} TIMEOUT_MS - Timeout padrão em milissegundos
 * @property {number} SESSION_LIMIT_MS - Limite de sessão em milissegundos
 * @property {number} IMAGE_QUALITY - Qualidade de compressão de imagem (0-1)
 * @property {number} IMAGE_MAX_WIDTH - Largura máxima para redimensionamento
 * @property {number} CACHE_TTL - TTL padrão do cache em milissegundos
 * @property {number} MAX_HISTORY_ITEMS - Máximo de itens no histórico
 * @property {number} DEBOUNCE_DELAY - Delay padrão para debounce em ms
 * @property {boolean} ENABLE_METRICS - Habilitar sistema de métricas
 * @property {boolean} ENABLE_CACHE - Habilitar sistema de cache
 * @property {boolean} ENABLE_AUTO_BACKUP - Habilitar backup automático
 * @property {number} AUTO_BACKUP_INTERVAL - Intervalo de backup em ms
 * @property {'debug'|'info'|'warn'|'error'} LOG_LEVEL - Nível de log
 */

/**
 * @type {AppConfig}
 */
export const CONFIG = Object.freeze({
  APP_ID: 'gestao-ferramentas-coeng-2026',
  TIMEOUT_MS: 8000,
  SESSION_LIMIT_MS: 1209600000, // 14 dias
  IMAGE_QUALITY: 0.6,
  IMAGE_MAX_WIDTH: 500,
  CACHE_TTL: 600000, // 10 minutos
  MAX_HISTORY_ITEMS: 1000,
  DEBOUNCE_DELAY: 300,
  ENABLE_METRICS: true,
  ENABLE_CACHE: true,
  ENABLE_AUTO_BACKUP: false,
  AUTO_BACKUP_INTERVAL: 3600000, // 1 hora
  LOG_LEVEL: 'info'
});

/**
 * @typedef {Object} FirebaseConfig
 * @property {string} apiKey
 * @property {string} authDomain
 * @property {string} projectId
 * @property {string} storageBucket
 * @property {string} messagingSenderId
 * @property {string} appId
 */

/**
 * @type {FirebaseConfig}
 */
export const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyBABhQgRW4CELN62ITlLxRBSrT1AfQ2fPI',
  authDomain: 'gestao-ferramentas-coeng-2026.firebaseapp.com',
  projectId: 'gestao-ferramentas-coeng-2026',
  storageBucket: 'gestao-ferramentas-coeng-2026.firebasestorage.app',
  messagingSenderId: '498524753209',
  appId: '1:498524753209:web:6068df61e9b35a9b4cece8'
});

/**
 * @typedef {Object} CollectionPaths
 * @property {string} TOOLS - Coleção de ferramentas
 * @property {string} USERS - Coleção de usuários
 * @property {string} COLLABORATORS - Coleção de colaboradores
 * @property {string} HISTORY - Coleção de histórico
 */

/**
 * @type {CollectionPaths}
 */
export const COLLECTIONS = Object.freeze({
  TOOLS: 'tools',
  USERS: 'users',
  COLLABORATORS: 'collaborators',
  HISTORY: 'history'
});

/**
 * @typedef {Object} CDNResources
 * @property {string} XLSX - URL do SheetJS
 * @property {string} JSPDF - URL do jsPDF
 * @property {string} QR_CODE - URL do QRCode library
 * @property {string} CHART_JS - URL do Chart.js
 */

/**
 * @type {CDNResources}
 */
export const CDN_URLS = Object.freeze({
  XLSX: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  JSPDF: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  QR_CODE: 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
  CHART_JS: 'https://cdn.jsdelivr.net/npm/chart.js'
});

/**
 * @typedef {Object} ToolStatus
 * @property {string} AVAILABLE - Disponível
 * @property {string} BORROWED - Emprestada
 * @property {string} MAINTENANCE - Em manutenção
 */

/**
 * @type {ToolStatus}
 */
export const TOOL_STATUS = Object.freeze({
  AVAILABLE: 'available',
  BORROWED: 'borrowed',
  MAINTENANCE: 'maintenance'
});

/**
 * @typedef {Object} HistoryType
 * @property {string} IN - Devolução
 * @property {string} OUT - Retirada
 * @property {string} MAINTENANCE - Manutenção
 */

/**
 * @type {HistoryType}
 */
export const HISTORY_TYPE = Object.freeze({
  IN: 'in',
  OUT: 'out',
  MAINTENANCE: 'maintenance'
});

/**
 * @typedef {Object} AccessLevel
 * @property {string} ADMIN - Administrador
 * @property {string} OPERATOR - Operador
 * @property {string} VIEWER - Visualizador
 */

/**
 * @type {AccessLevel}
 */
export const ACCESS_LEVEL = Object.freeze({
  ADMIN: 'Administrador',
  OPERATOR: 'Operador',
  VIEWER: 'Visualizador'
});

// Path base do Firestore
export const DB_BASE_PATH = `artifacts/${CONFIG.APP_ID}/public/data`;
