/**
 * Modelo ÚNICO de navegação do app shell (Gate 1-D).
 *
 * Toda a UI de navegação (sidebar, barra inferior, "Mais") e o roteador por hash derivam deste
 * arquivo. A UI apenas ESCONDE itens não permitidos; a autorização funcional continua nas
 * proteções existentes (permissões de App.Auth, regras do Firestore e APIs). `permission` referencia
 * um flag de App.Auth.permissions, sem duplicar regra de perfil aqui.
 */
export const DEFAULT_ROUTE = 'painel';
export const APP_TITLE = 'Gestão de Ferramentas';
export const MOBILE_PRIMARY_MAX = 4;

export const NAV_GROUPS = Object.freeze([
  { id: 'overview', label: 'Visão geral', order: 10 },
  { id: 'operation', label: 'Operação', order: 20 },
  { id: 'people', label: 'Pessoas', order: 30 },
  { id: 'control', label: 'Controle', order: 40 },
  { id: 'admin', label: 'Administração', order: 50 }
]);

export const NAV_ITEMS = Object.freeze([
  {
    id: 'dashboard',
    route: 'painel',
    tab: 'dashboard',
    label: 'Painel',
    title: 'Painel',
    icon: 'icon-dashboard',
    group: 'overview',
    permission: 'canAccessDashboard',
    order: 10,
    mobilePrimary: true
  },
  {
    id: 'scanner',
    route: 'scanner',
    tab: 'scanner',
    label: 'Retirar/Devolver',
    title: 'Retirar/Devolver',
    icon: 'icon-scanner',
    group: 'operation',
    permission: 'canAccessScanner',
    order: 20,
    mobilePrimary: true
  },
  {
    id: 'tools',
    route: 'ferramentas',
    tab: 'management',
    label: 'Ferramentas',
    title: 'Ferramentas',
    icon: 'icon-inventory',
    group: 'operation',
    permission: 'canReadTools',
    order: 30,
    mobilePrimary: true
  },
  {
    id: 'collaborators',
    route: 'colaboradores',
    tab: 'collaborators',
    label: 'Colaboradores',
    title: 'Colaboradores',
    icon: 'icon-users',
    group: 'people',
    permission: 'canReadCollaborators',
    deniedMessage: 'Acesso não permitido para o seu perfil.',
    order: 40,
    mobilePrimary: true
  },
  {
    id: 'history',
    route: 'auditoria',
    tab: 'history',
    label: 'Auditoria',
    title: 'Auditoria',
    icon: 'icon-history',
    group: 'control',
    permission: 'canAccessHistory',
    deniedMessage: 'Acesso restrito a administradores.',
    order: 50,
    mobilePrimary: false
  },
  {
    id: 'users',
    route: 'usuarios',
    tab: 'users',
    label: 'Usuários e acessos',
    title: 'Usuários e acessos',
    icon: 'icon-user-cog',
    group: 'admin',
    permission: 'canAccessUsers',
    deniedMessage: 'Acesso restrito a administradores.',
    order: 60,
    mobilePrimary: false
  }
]);

const byOrder = (a, b) => a.order - b.order;

export const getItemByRoute = (route) => NAV_ITEMS.find((item) => item.route === route) ?? null;
export const getItemByTab = (tab) => NAV_ITEMS.find((item) => item.tab === tab) ?? null;

// Um item só é permitido quando o flag existe E é exatamente true (falha fechado).
export const isItemAllowed = (item, permissions) => permissions?.[item.permission] === true;

export const getAllowedItems = (permissions) =>
  NAV_ITEMS.filter((item) => isItemAllowed(item, permissions)).sort(byOrder);

// Agrupa itens permitidos por grupo, na ordem dos grupos; grupos sem itens não aparecem.
export function getGroupedItems(permissions) {
  const allowed = getAllowedItems(permissions);

  return [...NAV_GROUPS]
    .sort(byOrder)
    .map((group) => ({ group, items: allowed.filter((item) => item.group === group.id) }))
    .filter(({ items }) => items.length > 0);
}

// Mobile: até MOBILE_PRIMARY_MAX destinos primários (barra inferior); o restante vai para "Mais".
export function splitForMobile(permissions) {
  const allowed = getAllowedItems(permissions);
  const primary = allowed.filter((item) => item.mobilePrimary).slice(0, MOBILE_PRIMARY_MAX);

  return { primary, more: allowed.filter((item) => !primary.includes(item)) };
}

export const hashForRoute = (route) => `#/${route}`;

// "#/ferramentas" -> "ferramentas"; vazio/inválido -> "".
export function routeFromHash(hash) {
  const match = /^#\/([^/?#]*)/.exec(String(hash ?? ''));

  if (!match) {
    return '';
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}
