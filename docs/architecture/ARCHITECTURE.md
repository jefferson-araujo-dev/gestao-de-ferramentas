# Arquitetura do Sistema - Gestão de Ferramentas v3

## 📋 Visão Geral

Este documento descreve a arquitetura profissional e as melhorias avançadas implementadas no sistema de gestão de ferramentas.

---

## 🏗️ Arquitetura

### Pattern de Arquitetura

O sistema utiliza uma arquitetura **modular baseada em módulos ES6** com os seguintes patterns de design:

- **Singleton**: Para serviços globais (EventBus, CacheManager, Metrics, etc.)
- **Observer/EventEmitter**: Para comunicação desacoplada entre módulos
- **Service Locator/Dependency Injection**: Para gerenciamento de serviços
- **Strategy**: Para handlers de erro e validação
- **Factory**: Para criação de objetos complexos
- **Builder**: Para construção de notificações e UI components

---

## 🎯 Core Modules

### 1. **EventEmitter** (`src/js/core/EventEmitter.js`)

Sistema avançado de eventos com pattern Observer.

**Funcionalidades:**
- ✅ Suporte a wildcards (`*`)
- ✅ Listeners one-time (`once`)
- ✅ Controle de memory leak (maxListeners)
- ✅ Error handling em listeners
- ✅ Múltiplos argumentos por evento

**Exemplo de Uso:**
```javascript
import { eventBus } from './core/EventEmitter.js';

// Registrar listener
eventBus.on('app:navigation', (screen) => {
  console.log('Navigated to:', screen);
});

// One-time listener
eventBus.once('app:ready', () => {
  console.log('App is ready!');
});

// Emit event
eventBus.emit('app:navigation', 'dashboard');

// Wildcard listener
eventBus.on('*', (event, ...args) => {
  console.log('Event:', event, args);
});
```

---

### 2. **ErrorHandler** (`src/js/core/ErrorHandler.js`)

Sistema centralizado de tratamento de erros com múltiplas estratégias.

**Classes de Erro:**
- `AppError` - Erro base customizado
- `ValidationError` - Erros de validação
- `AuthenticationError` - Erros de autenticação
- `AuthorizationError` - Erros de autorização
- `NotFoundError` - Recurso não encontrado
- `TimeoutError` - Timeout de operação
- `NetworkError` - Erros de rede
- `DatabaseError` - Erros de banco de dados

**Funcionalidades:**
- ✅ Handlers específicos por tipo de erro
- ✅ Histórico de erros (últimos 100)
- ✅ Contexto completo em cada erro
- ✅ Integração com Firebase
- ✅ Retry automático para erros de rede
- ✅ Wrapper de funções para captura automática

**Exemplo de Uso:**
```javascript
import { errorHandler, ValidationError } from './core/ErrorHandler.js';

// Criar erro customizado
throw new ValidationError('Email inválido', { field: 'email' });

// Capturar promise com handler automático
const result = await errorHandler.capture(
  fetchUserData(),
  { operation: 'fetch_user' }
);

// Wrapper de função
const safeFn = errorHandler.wrap(async (id) => {
  return await fetchUser(id);
});

// Registrar handler customizado
errorHandler.registerHandler('CUSTOM_ERROR', async (error, context) => {
  console.error('Custom error:', error);
  return { handled: true, action: 'custom_action' };
});
```

---

### 3. **CacheManager** (`src/js/core/CacheManager.js`)

Sistema inteligente de caching com TTL e estratégia LRU.

**Funcionalidades:**
- ✅ TTL (Time To Live) configurável
- ✅ Estratégia LRU (Least Recently Used)
- ✅ Auto cleanup de entradas expiradas
- ✅ Estatísticas detalhadas (hit rate, etc.)
- ✅ Persistência em localStorage
- ✅ Estimativa de tamanho em bytes

**Exemplo de Uso:**
```javascript
import { cacheManager } from './core/CacheManager.js';

// Set with TTL (10 minutos)
cacheManager.set('user_data', userData, { ttl: 600000 });

// Get from cache
const user = cacheManager.get('user_data');

// Get or set with factory function
const data = await cacheManager.getOrSet('expensive_query', 
  async () => await fetchFromDatabase(),
  { ttl: 300000 }
);

// Check if exists
if (cacheManager.has('key')) {
  // ...
}

// Get statistics
const stats = cacheManager.getStats();
console.log('Hit rate:', stats.hitRate); // ex: "85.50%"

// Persist to localStorage
cacheManager.persist('my-app-cache');

// Restore from localStorage
cacheManager.restore('my-app-cache');
```

---

### 4. **Validator** (`src/js/core/Validator.js`)

Sistema centralizado de validação de dados com schemas configuráveis.

**Funcionalidades:**
- ✅ Schemas predefinidos (user, tool, collaborator, history)
- ✅ Validações: required, type, min, max, pattern, oneOf, etc.
- ✅ Validadores customizados
- ✅ Sanitização automática
- ✅ Valores padrão (defaultValue)
- ✅ Dependências entre campos

**Exemplo de Uso:**
```javascript
import { validator } from './core/Validator.js';

// Validar usuário
const result = validator.validate('user', {
  name: 'John Doe',
  email: 'john@example.com',
  accessLevel: 'Administrador'
});

if (!result.valid) {
  console.error('Validation errors:', result.errors);
} else {
  console.log('Validated data:', result.data); // Dados sanitizados
}

// Registrar validador customizado
validator.registerValidator('unique_email', async (email, allData) => {
  const exists = await checkEmailInDatabase(email);
  return exists ? 'Email já cadastrado' : true;
});

// Registrar schema customizado
validator.register('product', {
  name: { required: true, type: 'string', minLength: 3 },
  price: { required: true, type: 'number', min: 0 },
  category: { required: true, oneOf: ['electronics', 'books', 'clothes'] }
});
```

---

### 5. **MetricsManager** (`src/js/core/MetricsManager.js`)

Sistema de métricas e analytics em tempo real.

**Funcionalidades:**
- ✅ Contadores com incremento/decremento
- ✅ Timers com laps
- ✅ Tracking de navegação
- ✅ Tracking de ações do usuário
- ✅ Tracking de erros
- ✅ Tracking de features
- ✅ Relatórios completos
- ✅ Persistência em localStorage

**Exemplo de Uso:**
```javascript
import { metrics } from './core/MetricsManager.js';

// Incrementar contador
metrics.increment('page_views');
metrics.increment('api.calls', 5);

// Timer
metrics.startTimer('api_request');
const data = await fetchData();
metrics.stopTimer('api_request', { endpoint: '/users' });

// Track navigation
metrics.trackNavigation('dashboard', 'view');

// Track action
metrics.trackAction('tools', 'create', 'power_drill');

// Track error
metrics.trackError('network', 'Connection timeout');

// Track feature usage
metrics.trackFeature('qr_scanner', 'use');

// Obter relatório
const report = metrics.getReport();
console.log(report.summary);

// Medir operação completa
await metrics.measure('operation_name', async () => {
  return await expensiveOperation();
}, { custom_tag: 'value' });
```

---

### 6. **NotificationManager** (`src/js/core/NotificationManager.js`)

Sistema avançado de notificações com templates e prioridades.

**Funcionalidades:**
- ✅ Tipos: success, error, warning, info, progress
- ✅ Templates predefinidos
- ✅ Notificações de progresso
- ✅ Notificações com ação (undo)
- ✅ Fila de notificações
- ✅ Máximo de notificações visíveis
- ✅ Sons de notificação
- ✅ Duração configurável

**Exemplo de Uso:**
```javascript
import { notifications } from './core/NotificationManager.js';

// Notificações simples
notifications.success('Operação realizada com sucesso!');
notifications.error('Erro ao processar solicitação');
notifications.warning('Atenção: dados não salvos');
notifications.info('Informação importante');

// Notificação com duração customizada
notifications.success('Salvo!', { duration: 2000 });

// Notificação de progresso
const id = notifications.progress('Processando...', 50);
// ... depois
notifications.progress('Processando...', 100); // Auto-dismiss em 100%

// Notificação com ação (undo)
notifications.action(
  'Item excluído',
  () => restoreItem(item),
  'Desfazer'
);

// Usar template
notifications.useTemplate('batch-operation', {
  count: 10,
  item: 'ferramenta',
  action: 'exportada'
});

// Usar template de backup
notifications.useTemplate('backup-complete', {
  total: 150
});

// Dismiss
notifications.dismiss(id);
notifications.dismissAll();
```

---

### 7. **ServiceContainer** (`src/js/core/ServiceContainer.js`)

Injeção de dependência e gerenciamento de serviços.

**Funcionalidades:**
- ✅ Registro de singletons
- ✅ Registro de factories
- ✅ Resolução automática de dependências
- ✅ Aliases para serviços
- ✅ Lazy loading
- ✅ Inicialização automática

**Exemplo de Uso:**
```javascript
import { container } from './core/ServiceContainer.js';

// Registrar singleton
container.singleton('userService', new UserService());

// Registrar factory
container.factory('httpClient', (config) => {
  return new HttpClient(config);
}, { dependencies: ['config'] });

// Registrar serviço direto
container.register('config', { apiUrl: 'https://api.example.com' });

// Criar alias
container.alias('userService', 'users');

// Obter serviço
const userService = await container.get('userService');
const users = await userService.getAll();

// Verificar se existe
if (container.has('userService')) {
  // ...
}

// Listar todos os serviços
const services = container.list();

// Inicializar todos os lazy
await container.initializeAll();
```

---

### 8. **AutoBackupManager** (`src/js/core/AutoBackupManager.js`)

Sistema automático de backup com agendamento e restauração.

**Funcionalidades:**
- ✅ Backup automático em intervalos configuráveis
- ✅ Backup manual
- ✅ Restauração completa
- ✅ Validação de dados
- ✅ Retry automático
- ✅ Histórico de backups
- ✅ Progresso em tempo real
- ✅ Métricas de backup

**Exemplo de Uso:**
```javascript
import { autoBackup } from './core/AutoBackupManager.js';

// Iniciar backup automático (a cada 1 hora)
autoBackup.start(3600000);

// Parar backup automático
autoBackup.stop();

// Backup manual
await autoBackup.backup({
  showProgress: true,
  includeHistory: true,
  compress: false,
  onProgress: (percent, message) => {
    console.log(`${percent}%: ${message}`);
  }
});

// Restaurar backup
const fileInput = document.getElementById('backup-file');
fileInput.addEventListener('change', async (e) => {
  await autoBackup.restore(e.target.files[0], {
    showProgress: true,
    onProgress: (percent, message) => {
      console.log(`${percent}%: ${message}`);
    }
  });
});

// Obter histórico
const history = autoBackup.getHistory();
const lastBackup = autoBackup.getLastBackup();
```

---

## 🛠️ Advanced Utilities

### **AdvancedUtils** (`src/js/utils/AdvancedUtils.js`)

Coleção de utilitários avançados para operações comuns.

**Funções Disponíveis:**

#### Debounce & Throttle
```javascript
import { debounce, throttle } from './utils/AdvancedUtils.js';

// Debounce com opções
const debouncedSearch = debounce((query) => {
  searchAPI(query);
}, 300, { leading: false, maxWait: 1000 });

// Throttle
const throttledScroll = throttle(() => {
  updateScrollPosition();
}, 100, { leading: true, trailing: true });

// Cancelar
debouncedSearch.cancel();
```

#### Retry Exponential
```javascript
import { retry } from './utils/AdvancedUtils.js';

const data = await retry(
  async (attempt) => {
    return await fetch('/api/data');
  },
  {
    times: 3,
    delay: 1000,
    maxDelay: 10000,
    factor: 2,
    onRetry: (error, attempt, maxAttempts) => {
      console.log(`Retry ${attempt}/${maxAttempts}`);
    }
  }
);
```

#### Promise Utilities
```javascript
import { withTimeout, sleep } from './utils/AdvancedUtils.js';

// Timeout
const data = await withTimeout(
  fetch('/api/slow-endpoint'),
  5000,
  'Request timeout'
);

// Sleep
await sleep(1000); // Espera 1 segundo
```

#### Object Utilities
```javascript
import { deepClone, deepMerge, get, set } from './utils/AdvancedUtils.js';

// Deep clone
const cloned = deepClone(originalObject);

// Deep merge
const merged = deepMerge(target, source);

// Get nested value
const value = get(obj, 'user.profile.email');
const valueWithDefault = get(obj, 'user.profile.phone', 'N/A');

// Set nested value
set(obj, 'user.profile.email', 'new@email.com');
```

#### Format Utilities
```javascript
import { 
  formatBytes, 
  formatRelativeDate, 
  formatCurrency,
  formatNumber,
  formatPercentage 
} from './utils/AdvancedUtils.js';

formatBytes(1234567); // "1.18 MB"
formatRelativeDate(new Date('2024-01-01')); // "há 2 meses"
formatCurrency(1234.56); // "R$ 1.234,56"
formatNumber(1234.5678, 2); // "1.234,57"
formatPercentage(75, 100); // "75%"
```

#### String Utilities
```javascript
import { 
  removeAccents, 
  escapeHTML, 
  normalizeCode,
  truncate,
  titleCase,
  getInitials 
} from './utils/AdvancedUtils.js';

removeAccents('João'); // "Joao"
escapeHTML('<script>'); // "&lt;script&gt;"
normalizeCode('pat-001'); // "PAT-001"
truncate('Texto longo', 10); // "Texto lon..."
titleCase('hello world'); // "Hello World"
getInitials('John Doe'); // "JD"
```

#### Array Utilities
```javascript
import { 
  groupBy, 
  orderBy, 
  uniqBy, 
  chunk 
} from './utils/AdvancedUtils.js';

groupBy(users, 'department');
orderBy(items, ['name', 'price'], ['asc', 'desc']);
uniqBy(duplicates, 'id');
chunk([1,2,3,4,5], 2); // [[1,2], [3,4], [5]]
```

#### VirtualList (Performance)
```javascript
import { VirtualList } from './utils/AdvancedUtils.js';

const virtualList = new VirtualList(container, {
  itemHeight: 100,
  buffer: 5,
  render: (item, index) => {
    const div = document.createElement('div');
    div.textContent = item.name;
    return div;
  }
});

virtualList.setItems(largeArrayOfItems);

// Destroy when done
virtualList.destroy();
```

---

## ⚙️ Configuração

### **Constants** (`src/js/config/constants.js`)

Configuração centralizada com tipos JSDoc.

```javascript
import { 
  CONFIG, 
  FIREBASE_CONFIG, 
  COLLECTIONS, 
  CDN_URLS,
  TOOL_STATUS,
  HISTORY_TYPE,
  ACCESS_LEVEL 
} from './config/constants.js';

// Configuração da aplicação
console.log(CONFIG.TIMEOUT_MS); // 8000
console.log(CONFIG.SESSION_LIMIT_MS); // 14 dias

// Status de ferramentas
console.log(TOOL_STATUS.AVAILABLE); // 'available'
console.log(TOOL_STATUS.BORROWED); // 'borrowed'

// Níveis de acesso
console.log(ACCESS_LEVEL.ADMIN); // 'Administrador'
```

---

## 📊 Métricas e Monitoramento

O sistema de métricas fornece insights valiosos sobre o uso da aplicação:

### Dashboard de Métricas

```javascript
import { metrics } from './core/MetricsManager.js';

// Obter relatório completo
const report = metrics.getReport();

console.log(report.summary.uptime); // Tempo de execução
console.log(report.summary.errorRate); // Taxa de erros
console.log(report.counters); // Todos os contadores

// Exportar métricas
const exported = metrics.exportMetrics();

// Persistir métricas
metrics.persist('app-metrics');

// Carregar métricas
metrics.load('app-metrics');
```

### Métricas Automáticas

O sistema automaticamente rastreia:
- ✅ Navegação entre telas
- ✅ Ações do usuário (CRUD operations)
- ✅ Uso de features (scanner, export, etc.)
- ✅ Erros e exceptions
- ✅ Performance de operações
- ✅ Tempo de sessão

---

## 🎨 CSS Avançado

### Metodologia BEM (Block Element Modifier)

O CSS foi refatorado para usar a metodologia BEM:

```css
/* Block */
.tool-card { }
.nav-btn { }
.stat-card { }

/* Element */
.tool-card__image { }
.tool-card__title { }
.tool-card__status { }

/* Modifier */
.tool-card--available { }
.tool-card--borrowed { }
.tool-card--maintenance { }
```

### Variáveis CSS Customizadas

```css
:root {
  --color-brand-50: #eff6ff;
  --color-brand-100: #dbeafe;
  /* ... mais variáveis */
  
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;
  
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.15);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.2);
}
```

---

## 🔒 Segurança

### XSS Protection
- ✅ Todas as strings são escaped com `escapeHTML()`
- ✅ Validação de inputs com Validator
- ✅ Sanitização automática de dados

### Error Handling
- ✅ Handlers específicos para Firebase errors
- ✅ Retry automático para erros de rede
- ✅ Graceful degradation

---

## 🚀 Performance

### Otimizações Implementadas

1. **VirtualList**: Renderização otimizada de listas longas
2. **CacheManager**: Cache inteligente com LRU
3. **Debounce/Throttle**: Controle de frequência de eventos
4. **Lazy Loading**: Carregamento sob demanda
5. **Memoization**: Cache de resultados de funções
6. **Code Splitting**: Módulos separados por feature

---

## 📦 Estrutura de Arquivos

```
src/
├── js/
│   ├── core/
│   │   ├── EventEmitter.js
│   │   ├── ErrorHandler.js
│   │   ├── CacheManager.js
│   │   ├── Validator.js
│   │   ├── MetricsManager.js
│   │   ├── ServiceContainer.js
│   │   ├── NotificationManager.js
│   │   ├── AutoBackupManager.js
│   │   └── index.js
│   ├── config/
│   │   └── constants.js
│   ├── utils/
│   │   └── AdvancedUtils.js
│   ├── modules/
│   │   ├── auth.js
│   │   ├── data.js
│   │   ├── ui.js
│   │   ├── scanner.js
│   │   ├── session.js
│   │   └── pdf.js
│   └── app.js
└── css/
    └── main.css
```

---

## 🎯 Próximas Melhorias

### Roadmap Futuro

- [ ] Migrar para TypeScript
- [ ] Implementar Service Workers (PWA)
- [ ] Adicionar WebSocket para real-time
- [ ] Implementar offline-first
- [ ] Adicionar testes unitários (Jest/Vitest)
- [ ] Adicionar testes E2E (Playwright/Cypress)
- [ ] Implementar CI/CD pipeline
- [ ] Adicionar análise de código (SonarQube)
- [ ] Implementar dark mode avanado
- [ ] Adicionar internacionalização (i18n)
- [ ] Implementar GraphQL
- [ ] Adicionar analytics avançado (Google Analytics, Mixpanel)

---

## 📚 Recursos e Documentação

### Patterns de Design Utilizados

- **Singleton**: https://refactoring.guru/design-patterns/singleton
- **Observer**: https://refactoring.guru/design-patterns/observer
- **Strategy**: https://refactoring.guru/design-patterns/strategy
- **Factory**: https://refactoring.guru/design-patterns/factory-method
- **Builder**: https://refactoring.guru/design-patterns/builder

### Boas Práticas

- **ESLint**: Padronização de código
- **Prettier**: Formatação automática
- **JSDoc**: Documentação de código
- **BEM**: Metodologia CSS

---

## 🤝 Contribuindo

Para contribuir com melhorias:

1. Leia a documentação dos módulos core
2. Siga os patterns de design estabelecidos
3. Adicione JSDoc em todas as funções públicas
4. Crie testes para novas funcionalidades
5. Execute `npm run lint` antes de commitar

---

## 📄 Licença

Sistema proprietário - COENG © 2026

---

**Versão**: 3.0.0  
**Última Atualização**: Abril 2026  
**Responsável**: Jefferson
