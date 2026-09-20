// Dados 100% sintéticos e determinísticos para o E2E (somente emulator).
// Datas fixas, nenhum dado real, nenhuma credencial real.

export const E2E_PASSWORD = 'E2e-Local-Emulator-Only-1!';

export const E2E_USERS = Object.freeze({
  admin: {
    key: 'admin',
    email: 'admin.e2e@emulador.local',
    name: 'Ana Administradora',
    accessLevel: 'Administrador',
    department: 'Teste',
    status: 'Ativo',
    isRestricted: false,
    role: 'Administrador',
  },
  standard: {
    key: 'standard',
    email: 'padrao.e2e@emulador.local',
    name: 'Paulo Padrao',
    accessLevel: 'Usuário Padrão',
    department: 'Teste',
    status: 'Ativo',
    isRestricted: false,
    role: 'Usuário',
  },
  restricted: {
    key: 'restricted',
    email: 'restrito.e2e@emulador.local',
    name: 'Rita Restrita',
    accessLevel: 'Usuário Padrão',
    department: 'Teste',
    status: 'Ativo',
    isRestricted: true,
    role: 'Usuário',
  },
});

const tool = (code, name, category, status, extra = {}) => ({
  code,
  name,
  category,
  status,
  currentUser: null,
  lastAction: null,
  imageUrl: null,
  condition: 'Boa',
  nextMaintenance: null,
  notes: 'Ferramenta sintética do E2E.',
  manualUrl: null,
  manualName: null,
  ...extra,
});

export const E2E_TOOLS = Object.freeze({
  'T-E2E-001': tool('T-E2E-001', 'Furadeira de Impacto', 'Elétrica', 'available'),
  'T-E2E-002': tool('T-E2E-002', 'Parafusadeira', 'Elétrica', 'borrowed', {
    currentUser: 'Colaborador Alfa',
    currentCollaboratorId: 'c-e2e-1',
    lastAction: '2026-08-12T13:00:00.000Z',
  }),
  'T-E2E-003': tool('T-E2E-003', 'Martelo', 'Manual', 'available'),
  'T-E2E-004': tool('T-E2E-004', 'Serra Circular', 'Elétrica', 'maintenance'),
  'T-E2E-005': tool('T-E2E-005', 'Chave de Fenda', 'Manual', 'available'),
  'T-E2E-006': tool('T-E2E-006', 'Esmerilhadeira', 'Elétrica', 'borrowed', {
    currentUser: 'Colaborador Beta',
    currentCollaboratorId: 'c-e2e-2',
    lastAction: '2026-08-13T13:00:00.000Z',
  }),
  'T-E2E-007': tool('T-E2E-007', 'Nível a Laser', 'Medição', 'available'),
  'T-E2E-008': tool('T-E2E-008', 'Trena', 'Medição', 'maintenance'),
});

const collaborator = (badge, name, role, status) => ({
  badge,
  name,
  role,
  phone: '(00) 00000-0000',
  status,
  imageUrl: null,
});

export const E2E_COLLABORATORS = Object.freeze({
  'c-e2e-1': collaborator('E2E-001', 'Colaborador Alfa', 'Operador', 'active'),
  'c-e2e-2': collaborator('E2E-002', 'Colaborador Beta', 'Operador', 'active'),
  'c-e2e-3': collaborator('E2E-003', 'Colaborador Gama', 'Auxiliar', 'active'),
  'c-e2e-4': collaborator('E2E-004', 'Colaborador Delta', 'Supervisor', 'active'),
  'c-e2e-5': collaborator('E2E-005', 'Colaborador Epsilon', 'Auxiliar', 'inactive'),
});

const log = (date, type, toolCode, toolName, user) => ({
  date,
  type,
  toolCode,
  toolName,
  user,
  ip: 'Registrado no servidor',
  device: 'Chrome / Windows',
});

export const E2E_HISTORY = Object.freeze({
  'h-e2e-1': log(
    '2026-08-10T12:00:00.000Z',
    'out',
    'T-E2E-001',
    'Furadeira de Impacto',
    'Colaborador Alfa'
  ),
  'h-e2e-2': log(
    '2026-08-10T15:00:00.000Z',
    'in',
    'T-E2E-001',
    'Furadeira de Impacto',
    'Colaborador Alfa'
  ),
  'h-e2e-3': log(
    '2026-08-12T13:00:00.000Z',
    'out',
    'T-E2E-002',
    'Parafusadeira',
    'Colaborador Alfa'
  ),
  'h-e2e-4': log(
    '2026-08-13T13:00:00.000Z',
    'out',
    'T-E2E-006',
    'Esmerilhadeira',
    'Colaborador Beta'
  ),
  'h-e2e-5': log(
    '2026-08-14T09:00:00.000Z',
    'maintenance',
    'T-E2E-004',
    'Serra Circular',
    'Ana Administradora'
  ),
  'h-e2e-6': log(
    '2026-08-14T10:00:00.000Z',
    'maintenance',
    'T-E2E-008',
    'Trena',
    'Ana Administradora'
  ),
});

export const E2E_EXPECTED_COUNTS = Object.freeze({
  tools: Object.keys(E2E_TOOLS).length,
  available: 4,
  borrowed: 2,
  maintenance: 2,
  collaborators: Object.keys(E2E_COLLABORATORS).length,
  history: Object.keys(E2E_HISTORY).length,
  users: Object.keys(E2E_USERS).length,
});
