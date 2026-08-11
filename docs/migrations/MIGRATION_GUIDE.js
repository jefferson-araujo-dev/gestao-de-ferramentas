/**
 * Migration Guide - Como usar os novos módulos avançados
 * 
 * Este arquivo mostra exemplos práticos de como integrar os novos
 * módulos core ao código existente do sistema.
 */

// ========================================
// 1. EVENT EMITTER - Eventos desacoplados
// ========================================

import { eventBus } from './core/EventEmitter.js';

// Exemplo: Disparar evento ao trocar de aba
function switchTab(tabName) {
  // Código existente...
  
  // NOVO: Disparar evento para métricas e outros listeners
  eventBus.emit('app:navigation', tabName);
}

// Exemplo: Registrar listener para erros
eventBus.on('app:error', (error) => {
  console.error('Global error handler:', error);
  // Enviar para serviço de analytics, etc.
});

// Exemplo: Listener one-time para inicialização
eventBus.once('app:ready', () => {
  console.log('App fully initialized!');
});


// ========================================
// 2. ERROR HANDLER - Tratamento profissional de erros
// ========================================

import { errorHandler, ValidationError, NotFoundError } from './core/ErrorHandler.js';

// Exemplo: Validar dados com erro customizado
function createUser(userData) {
  if (!userData.name || !userData.email) {
    throw new ValidationError('Nome e email são obrigatórios', {
      field: 'name,email',
      data: userData
    });
  }
  
  // Código de criação...
}

// Exemplo: Capturar erros de Firebase automaticamente
async function fetchTools() {
  return await errorHandler.capture(
    getDocs(collection(db, 'tools')),
    { operation: 'fetch_tools' }
  );
}

// Exemplo: Wrapper de função segura
const safeUpdateTool = errorHandler.wrap(async (toolId, updates) => {
  return await updateDoc(doc(db, 'tools', toolId), updates);
}, { operation: 'update_tool' });


// ========================================
// 3. CACHE MANAGER - Cache inteligente
// ========================================

import { cacheManager } from './core/CacheManager.js';

// Exemplo: Cache de dados de ferramentas
async function getTools() {
  return await cacheManager.getOrSet(
    'tools_list',
    async () => {
      const snapshot = await getDocs(collection(db, 'tools'));
      return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    { ttl: 300000 } // 5 minutos
  );
}

// Exemplo: Cache de usuário logado
function getCachedUser() {
  return cacheManager.get('current_user');
}

function setCachedUser(user) {
  cacheManager.set('current_user', user, { ttl: 86400000 }); // 24 horas
}

// Exemplo: Verificar estatísticas do cache
function showCacheStats() {
  const stats = cacheManager.getStats();
  console.log('Cache hit rate:', stats.hitRate);
  console.log('Total size:', stats.totalSize);
}


// ========================================
// 4. VALIDATOR - Validação centralizada
// ========================================

import { validator } from './core/Validator.js';

// Exemplo: Validar nova ferramenta
function createTool(toolData) {
  const result = validator.validate('tool', toolData);
  
  if (!result.valid) {
    console.error('Validation errors:', result.errors);
    throw new Error('Dados inválidos');
  }
  
  // Usar dados sanitizados
  return addDoc(collection(db, 'tools'), result.data);
}

// Exemplo: Validar colaborador
function createCollaborator(data) {
  const result = validator.validate('collaborator', data);
  
  if (!result.valid) {
    const messages = result.errors.map(e => e.message).join(', ');
    throw new ValidationError(messages);
  }
  
  return addDoc(collection(db, 'collaborators'), result.data);
}


// ========================================
// 5. METRICS - Métricas e analytics
// ========================================

import { metrics } from './core/MetricsManager.js';

// Exemplo: Track de navegação
function switchTab(tabName) {
  metrics.trackNavigation(tabName, 'view');
  
  // Código existente...
}

// Exemplo: Track de ação
async function createTool(toolData) {
  metrics.trackAction('tools', 'create', toolData.category);
  
  // Código existente...
}

// Exemplo: Medir performance de operação
async function fetchTools() {
  return await metrics.measure('fetch_tools', async () => {
    const snapshot = await getDocs(collection(db, 'tools'));
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  });
}

// Exemplo: Track de erro
function handleToolError(error) {
  metrics.trackError('tool_operation', error.message, {
    operation: 'create_tool'
  });
}


// ========================================
// 6. NOTIFICATIONS - Notificações avançadas
// ========================================

import { notifications } from './core/NotificationManager.js';

// Exemplo: Notificações simples
function onSuccess(message) {
  notifications.success(message);
}

function onError(message) {
  notifications.error(message);
}

// Exemplo: Notificação de progresso
async function importData(file) {
  const notificationId = notifications.progress('Importando dados...', 0);
  
  // Processar em chunks
  for (let i = 0; i < chunks.length; i++) {
    const progress = ((i + 1) / chunks.length) * 100;
    notifications.progress(notificationId, progress);
    
    await processChunk(chunks[i]);
  }
  
  // Completado
  notifications.progress(notificationId, 100); // Auto-dismiss
}

// Exemplo: Notificação com ação (undo)
function deleteTool(toolId) {
  const tool = getToolById(toolId);
  
  // Deletar...
  
  notifications.action(
    `Ferramenta "${tool.name}" excluída`,
    () => restoreTool(tool),
    'Desfazer'
  );
}

// Exemplo: Usar templates
notifications.useTemplate('batch-operation', {
  count: 10,
  item: 'ferramenta',
  action: 'exportada'
});


// ========================================
// 7. ADVANCED UTILS - Utilitários avançados
// ========================================

import { 
  debounce, 
  throttle,
  retry,
  deepClone,
  formatCurrency,
  groupBy,
  orderBy,
  VirtualList 
} from './utils/AdvancedUtils.js';

// Exemplo: Debounce em busca
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', debounce(async (e) => {
  const results = await searchTools(e.target.value);
  renderResults(results);
}, 300));

// Exemplo: Throttle em scroll
const scrollContainer = document.getElementById('scroll-container');
scrollContainer.addEventListener('scroll', throttle(() => {
  updateScrollPosition();
}, 100));

// Exemplo: Retry em operação de rede
async function fetchWithRetry() {
  return await retry(
    async (attempt) => {
      const response = await fetch('/api/tools');
      return response.json();
    },
    {
      times: 3,
      delay: 1000,
      onRetry: (error, attempt) => {
        console.log(`Retry ${attempt}/3`);
      }
    }
  );
}

// Exemplo: GroupBy e OrderBy
function renderTools(tools) {
  const grouped = groupBy(tools, 'category');
  
  for (const [category, items] of Object.entries(grouped)) {
    const sorted = orderBy(items, ['name'], ['asc']);
    renderCategory(category, sorted);
  }
}

// Exemplo: VirtualList para performance
const virtualList = new VirtualList(container, {
  itemHeight: 100,
  buffer: 5,
  render: (tool) => {
    const div = document.createElement('div');
    div.className = 'tool-card';
    div.innerHTML = `<h3>${tool.name}</h3><p>${tool.code}</p>`;
    return div;
  }
});

virtualList.setItems(allTools);


// ========================================
// 8. AUTO BACKUP - Backup automático
// ========================================

import { autoBackup } from './core/AutoBackupManager.js';

// Exemplo: Iniciar backup automático ao logar
function onLogin() {
  // Código existente...
  
  // NOVO: Iniciar backup automático (a cada 1 hora)
  autoBackup.start(3600000);
}

// Exemplo: Backup manual
async function manualBackup() {
  try {
    await autoBackup.backup({
      showProgress: true,
      onProgress: (percent, message) => {
        console.log(`${percent}%: ${message}`);
      }
    });
  } catch (error) {
    console.error('Backup failed:', error);
  }
}

// Exemplo: Restaurar backup
async function restoreBackup(file) {
  try {
    await autoBackup.restore(file, {
      showProgress: true,
      onProgress: (percent, message) => {
        console.log(`${percent}%: ${message}`);
      }
    });
    
    // Recarregar dados
    window.App.Data.init();
  } catch (error) {
    console.error('Restore failed:', error);
  }
}


// ========================================
// 9. SERVICE CONTAINER - Injeção de dependência
// ========================================

import { container } from './core/ServiceContainer.js';

// Exemplo: Registrar serviços
container.singleton('toolService', new ToolService());
container.singleton('userService', new UserService());
container.factory('httpClient', (config) => {
  return new HttpClient(config);
});

// Exemplo: Usar serviços
async function getTools() {
  const toolService = await container.get('toolService');
  return await toolService.getAll();
}


// ========================================
// INTEGRAÇÃO COM CÓDIGO EXISTENTE
// ========================================

// Exemplo: Como integrar com o AppAuth existente

import { eventBus } from './core/EventEmitter.js';
import { metrics } from './core/MetricsManager.js';
import { notifications } from './core/NotificationManager.js';

// No módulo auth.js, adicionar:
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // Código existente...
    
    // NOVO: Disparar eventos e métricas
    eventBus.emit('app:user:login', { email: user.email });
    metrics.trackFeature('auth', 'login');
    notifications.success(`Bem-vindo de volta, ${userName}!`);
  } else {
    // Código existente...
    
    // NOVO: Disparar eventos
    eventBus.emit('app:user:logout');
    metrics.trackFeature('auth', 'logout');
    autoBackup.stop(); // Parar backup automático
  }
});


// Exemplo: Como integrar com AppData existente

import { cacheManager } from './core/CacheManager.js';
import { metrics } from './core/MetricsManager.js';
import { errorHandler } from './core/ErrorHandler.js';

// No módulo data.js, modificar:
init: function() {
  // Código existente...
  
  this.listeners.push(
    onSnapshot(collection(db, 'tools'), async (snapshot) => {
      try {
        // Medir performance
        await metrics.measure('process_tools_snapshot', async () => {
          this.tools = snapshot.docs.map(d => ({
            firebaseId: d.id,
            ...d.data()
          }));
          this.toolsLoaded = true;
          
          // Cache dos dados
          cacheManager.set('tools_cache', this.tools, { ttl: 300000 });
          
          // Renderizar
          window.App.UI.renderAll();
        });
      } catch (error) {
        // Error handling automático
        await errorHandler.handleError(error, {
          operation: 'process_tools_snapshot'
        });
      }
    })
  );
}


// ========================================
// MIGRAÇÃO GRADUAL
// ========================================

/**
 * NÃO é necessário migrar tudo de uma vez!
 * 
 * Você pode:
 * 1. Usar os novos módulos APENAR em novas funcionalidades
 * 2. Migrar gradualmente módulos existentes
 * 3. Usar em paralelo com código antigo
 * 
 * Exemplo de uso paralelo:
 */

// Código antigo (continua funcionando)
window.App.UI.showToast('Mensagem', 'success');

// Código novo (em novas funcionalidades)
notifications.success('Mensagem');

// Ambos funcionam! Escolha o que preferir.


// ========================================
// INSTALAÇÃO DE DEPENDÊNCIAS
// ========================================

/**
 * Para instalar ESLint e Prettier:
 * 
 * npm install --save-dev eslint @eslint/js prettier globals
 * 
 * Para usar:
 * 
 * npm run lint          # Verificar erros
 * npm run lint:fix      # Corrigir automaticamente
 * npm run format        # Formatar código
 * npm run format:check  # Verificar formatação
 */


// ========================================
// RESUMO DAS MELHORIAS
// ========================================

/**
 * ✅ Event Emitter - Eventos desacoplados
 * ✅ Error Handler - Tratamento profissional de erros
 * ✅ Cache Manager - Cache inteligente com TTL e LRU
 * ✅ Validator - Validação centralizada com schemas
 * ✅ Metrics - Métricas e analytics em tempo real
 * ✅ Notifications - Notificações avançadas com templates
 * ✅ Auto Backup - Backup automático com agendamento
 * ✅ Service Container - Injeção de dependência
 * ✅ Advanced Utils - Utilitários profissionais
 * ✅ ESLint + Prettier - Padronização de código
 * ✅ JSDoc - Documentação completa
 * 
 * Patterns de Design:
 * - Singleton
 * - Observer/EventEmitter
 * - Strategy
 * - Factory
 * - Builder
 * - Service Locator
 */
