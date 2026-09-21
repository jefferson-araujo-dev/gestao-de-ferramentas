import {
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, auth, DB_BASE_PATH, COLLECTIONS, CONFIG } from '../app.js';
import {
  Alert,
  Badge,
  Button,
  Dropdown,
  EmptyState,
  IconButton,
  Search,
  Select,
  SkeletonCard,
  StatusBadge,
  esc,
  icon,
  isBusy,
  setBusy
} from '../components/index.js';
import { BREAKPOINTS } from '../config/breakpoints.js';

// Situação do colaborador: os mesmos valores persistidos de sempre ('active'/'inactive').
const STATUS_FILTERS = Object.freeze([
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' }
]);

const SORT_OPTIONS = Object.freeze([
  { value: 'name-asc', label: 'Nome A-Z' },
  { value: 'name-desc', label: 'Nome Z-A' },
  { value: 'badge', label: 'Crachá' },
  { value: 'recent', label: 'Mais recentes' }
]);

const SEM_CARGO = 'Sem cargo';

// A lista vira tabela a partir do notebook (rail + conteúdo largo); abaixo disso são cartões.
const TABLE_QUERY = `(min-width: ${BREAKPOINTS.notebook}px)`;

export const AppCRUDCollaborators = {
  collabLimit: 30,
  selectedCollabs: new Set(),
  currentStatusFilter: 'all',
  currentPendingFilter: 'all',
  imagePreviewInitialized: false,
  _mounted: false,
  _menus: [],
  _renderPending: false,

  _hasPermission: function (permission) {
    return window.App?.Auth?.permissions?.[permission] === true;
  },
  _denyAccess: function () {
    window.App.UI.showToast('Acesso restrito a administradores.', 'error');
  },

  // Filtros e busca/ordenação são montados uma única vez (com os componentes do design system) e
  // depois só atualizados: assim o foco do usuário não se perde a cada renderização.
  mountControls: function () {
    const filters = document.getElementById('collab-filters');
    const pending = document.getElementById('collab-pending-filters');
    const toolbar = document.getElementById('collab-toolbar');

    if (this._mounted || !filters || !pending || !toolbar) {
      return;
    }

    this._mounted = true;

    const chip = (attribute, value, label, pressed) =>
      `<button type="button" class="ui-btn ui-btn--secondary ui-btn--sm collab-chip" ${attribute}="${value}" aria-pressed="${pressed}"><span class="ui-btn__label">${esc(label)}</span><span class="collab-chip__count" data-collab-count="${value}">0</span></button>`;

    filters.innerHTML = STATUS_FILTERS.map((filter) =>
      chip('data-collab-filter', filter.value, filter.label, filter.value === this.currentStatusFilter)
    ).join('');

    // Pendências é um filtro independente da situação: alterna sozinho (ligado/desligado).
    pending.innerHTML = chip(
      'data-collab-pending',
      'pending',
      'Com pendências',
      this.currentPendingFilter === 'pending'
    );

    toolbar.innerHTML =
      Search({
        id: 'collab-search',
        label: 'Buscar por nome, crachá ou cargo',
        placeholder: 'Nome, crachá ou cargo',
        className: 'collab-toolbar__search'
      }) +
      Select({
        id: 'collab-role-filter',
        label: 'Filtrar por cargo',
        hideLabel: true,
        className: 'collab-toolbar__select',
        options: [{ value: 'all', label: 'Todos os cargos' }]
      }) +
      Select({
        id: 'collab-sort',
        label: 'Ordenar por',
        hideLabel: true,
        className: 'collab-toolbar__select',
        options: SORT_OPTIONS
      });

    this._bindEvents();
  },

  // Listeners da tela (delegação): nada de onclick inline nos itens renderizados.
  _bindEvents: function () {
    const screen = document.getElementById('tab-collaborators');

    screen?.addEventListener('click', (event) => this._onClick(event));

    ['collab-role-filter', 'collab-sort'].forEach((id) =>
      document.getElementById(id)?.addEventListener('change', () => {
        this.collabLimit = 30;
        this.render();
      })
    );
    document.getElementById('collab-group-toggle')?.addEventListener('change', () => {
      this.collabLimit = 30;
      this.render();
    });
    document
      .getElementById('crud-import-input-collab')
      ?.addEventListener('change', (event) => this.importFile(event));

    // O formulário fica fora da seção da tela (área de modais): mesma delegação, outro nó raiz.
    document
      .getElementById('crud-collab-modal')
      ?.addEventListener('click', (event) => this._onClick(event));

    // A lista troca de forma (tabela x cartões) na mudança do breakpoint; os dados são os mesmos.
    window.matchMedia(TABLE_QUERY).addEventListener('change', () => {
      if (window.App?.UI?.activeTab === 'collaborators') {
        this.render();
      }
    });
  },

  _onClick: function (event) {
    const status = event.target.closest('[data-collab-filter]');

    if (status) {
      this.setStatusFilter(status.dataset.collabFilter);
      return;
    }

    const pending = event.target.closest('[data-collab-pending]');

    if (pending) {
      this.setPendingFilter(this.currentPendingFilter === 'pending' ? 'all' : 'pending');
      return;
    }

    const trigger = event.target.closest('[data-collab-action]');

    if (!trigger || trigger.disabled) {
      return;
    }

    const { collabAction: action, collabId } = trigger.dataset;

    // Item de menu: devolve o foco ao gatilho da linha antes da ação. Se a ação abrir um modal, o
    // navegador devolve o foco a esse gatilho ao fechá-lo (o item do menu já não existe visível).
    if (trigger.getAttribute('role') === 'menuitem') {
      this._focusMenuTrigger(collabId);
    }

    switch (action) {
      case 'export':
        this.exportList();
        break;
      case 'import':
        document.getElementById('crud-import-input-collab')?.click();
        break;
      case 'new':
        this.openModal();
        break;
      case 'save':
        this.saveCollaborator();
        break;
      case 'clear-filters':
        this.clearFilters();
        break;
      case 'load-more':
        this.loadMore();
        break;
      case 'edit':
        this.openModal(collabId);
        break;
      case 'history':
        this.showHistory(trigger.dataset.collabName);
        break;
      case 'toggle-status':
        this.toggleStatus(collabId);
        break;
      case 'delete':
        this.deleteCollaborator(collabId);
        break;
      case 'preview':
        window.App.UI.showImagePreview(
          trigger.querySelector('img')?.src || '',
          trigger.dataset.collabName
        );
        break;
      default:
    }
  },

  setStatusFilter: function (filter) {
    this.currentStatusFilter = filter;
    this.collabLimit = 30;
    this._syncChips();
    this.render();
  },

  setPendingFilter: function (filter) {
    this.currentPendingFilter = filter;
    this.collabLimit = 30;
    this._syncChips();
    this.render();
  },

  clearFilters: function () {
    const search = document.getElementById('collab-search');
    const role = document.getElementById('collab-role-filter');

    if (search) {
      search.value = '';
    }

    if (role) {
      role.value = 'all';
    }

    this.currentStatusFilter = 'all';
    this.currentPendingFilter = 'all';
    this.collabLimit = 30;
    this._syncChips();
    this.render();
    // O botão "Limpar filtros" some ao limpar: o foco vai para a busca, não se perde.
    search?.focus();
  },

  _syncChips: function () {
    document.querySelectorAll('[data-collab-filter]').forEach((chip) => {
      chip.setAttribute(
        'aria-pressed',
        String(chip.dataset.collabFilter === this.currentStatusFilter)
      );
    });
    document.querySelectorAll('[data-collab-pending]').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(this.currentPendingFilter === 'pending'));
    });
  },

  // Os cargos vêm dos dados carregados (a lista só é conhecida depois do carregamento).
  _syncRoles: function (collaborators) {
    const select = document.getElementById('collab-role-filter');

    if (!select) {
      return;
    }

    const roles = [...new Set(collaborators.map((c) => c.role).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'pt-BR')
    );
    const key = roles.join('\u0000');

    if (select.dataset.roles === key) {
      return;
    }

    const previous = select.value;

    select.innerHTML =
      '<option value="all">Todos os cargos</option>' +
      roles.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    select.value = roles.includes(previous) ? previous : 'all';
    select.dataset.roles = key;
  },

  _isTableLayout: function () {
    return window.matchMedia(TABLE_QUERY).matches;
  },

  _disposeMenus: function () {
    this._menus.forEach((menu) => menu.dispose());
    this._menus = [];
  },

  _mountMenus: function (list) {
    this._menus = [...list.querySelectorAll('[data-dropdown]')].map(
      (root) =>
        new Dropdown({
          trigger: root.querySelector('[data-collab-menu-trigger]'),
          panel: root.querySelector('.ui-menu'),
          onOpen: () => this._setBackgroundInert(root.closest('[data-collab-row]')),
          onClose: ({ restoreFocus } = {}) => {
            this._setBackgroundInert(null);
            this._flushPendingRender({
              restoreFocus,
              collabId: root.closest('[data-collab-row]')?.dataset.collabId
            });
          }
        })
    );
  },

  // Mesma correção do Addendum 1-F2.1: com um menu de linha aberto o resto da tela fica inerte (sem
  // clique, sem foco). O menu flutuante cobre parte de botões de outras linhas e um clique fora dele,
  // sobre uma faixa ainda visível, fecharia o menu E acionaria o botão de baixo.
  _setBackgroundInert: function (activeRow) {
    document
      .querySelectorAll(
        '#collab-screen .collab-header, #collab-filters, #collab-pending-filters, #collab-toolbar, .collab-meta, #collab-load-more, #collab-list [data-collab-row]'
      )
      .forEach((element) => {
        element.inert = Boolean(activeRow) && element !== activeRow;
      });
  },

  // Uma atualização de dados durante um menu aberto espera o menu fechar: re-renderizar agora
  // faria o menu sumir debaixo do teclado/leitor de tela.
  _flushPendingRender: function ({ restoreFocus = false, collabId } = {}) {
    if (this._renderPending && !this._menus.some((menu) => menu.isOpen())) {
      this._renderPending = false;
      this.render();

      // O gatilho antigo saiu do DOM com a renderização: o foco volta ao gatilho novo da mesma linha.
      if (restoreFocus) {
        this._focusMenuTrigger(collabId);
      }
    }
  },

  _focusMenuTrigger: function (collabId) {
    const row = [...document.querySelectorAll('#collab-list [data-collab-row]')].find(
      (element) => element.dataset.collabId === collabId
    );

    row?.querySelector('[data-collab-menu-trigger]')?.focus({ preventScroll: true });
  },

  // Erro de um campo do formulário: mensagem ligada ao próprio campo (aria-describedby já no HTML),
  // além do toast. Mensagem vazia limpa o estado.
  _setFieldError: function (id, message) {
    const control = document.getElementById(id);
    const error = document.getElementById(`${id}-error`);

    if (!control || !error) {
      return;
    }

    control.setAttribute('aria-invalid', message ? 'true' : 'false');
    control.closest('.ui-field')?.classList.toggle('is-invalid', Boolean(message));
    error.textContent = message;
    error.hidden = !message;
  },

  _setMeta: function ({ count, filters = 0 }) {
    const countEl = document.getElementById('collab-result-count');
    const filtersEl = document.getElementById('collab-active-filters');
    const clearButton = document.getElementById('collab-clear-filters');

    if (countEl) {
      countEl.textContent = count;
    }

    if (filtersEl) {
      filtersEl.textContent = filters
        ? `${filters} filtro${filters !== 1 ? 's' : ''} ativo${filters !== 1 ? 's' : ''}`
        : '';
    }

    if (clearButton) {
      clearButton.hidden = filters === 0;
    }
  },

  toggleSelection: function (id) {
    if (this.selectedCollabs.has(id)) {
      this.selectedCollabs.delete(id);
    } else {
      this.selectedCollabs.add(id);
    }
    this.updateBulkBar();
    this.render();
  },

  clearSelection: function () {
    this.selectedCollabs.clear();
    this.updateBulkBar();
    this.render();
  },

  updateBulkBar: function () {
    const bar = document.getElementById('collab-bulk-actions-bar');
    const count = document.getElementById('collab-bulk-selected-count');
    if (bar && count) {
      if (this.selectedCollabs.size > 0) {
        bar.classList.remove('hidden');
        bar.classList.add('flex');
        count.textContent = this.selectedCollabs.size;
      } else {
        bar.classList.add('hidden');
        bar.classList.remove('flex');
      }
    }
  },

  getPendingTools: function (collabName) {
    if (!collabName) {
      return [];
    }
    return window.App.Data.tools.filter(
      (t) => t.status === 'borrowed' && t.currentUser === collabName
    );
  },

  render: function () {
    const list = window.App.UI.domCache?.collabList || document.getElementById('collab-list');

    if (!list) {
      return;
    }

    if (this._menus.some((menu) => menu.isOpen())) {
      this._renderPending = true;
      return;
    }

    this._disposeMenus();

    const loadMore = document.getElementById('collab-load-more');
    const feedback = document.getElementById('collab-feedback');

    if (feedback) {
      feedback.innerHTML = '';
    }

    if (!window.App.Data.collaboratorsLoaded) {
      list.setAttribute('aria-busy', 'true');
      list.innerHTML = `<div class="collab-skeleton">${Array(6).fill(SkeletonCard()).join('')}</div>`;
      this._setMeta({ count: 'Carregando colaboradores...' });

      if (loadMore) {
        loadMore.hidden = true;
      }

      return;
    }

    list.removeAttribute('aria-busy');

    // Falha ao carregar: aviso persistente e distinto de "nenhum colaborador cadastrado".
    if (window.App.Data.collaboratorsError) {
      if (feedback) {
        feedback.innerHTML = Alert({
          tone: 'danger',
          title: 'Não foi possível carregar os colaboradores',
          message:
            'Verifique a conexão e recarregue a página. Se o problema continuar, procure um administrador.'
        });
      }

      list.innerHTML = '';
      this._setMeta({ count: '' });

      if (loadMore) {
        loadMore.hidden = true;
      }

      return;
    }

    const collaborators = window.App.Data.collaborators;
    const isActive = (c) => (c.status || 'active') === 'active';

    const counts = {
      all: collaborators.length,
      active: collaborators.filter(isActive).length,
      inactive: collaborators.filter((c) => !isActive(c)).length,
      pending: collaborators.filter((c) => this.getPendingTools(c.name).length > 0).length
    };

    document.querySelectorAll('[data-collab-count]').forEach((element) => {
      element.textContent = counts[element.dataset.collabCount] ?? 0;
    });
    this._syncChips();
    this._syncRoles(collaborators);

    const q = window.Utils.removeAccents(
      document.getElementById('collab-search')?.value.trim() || ''
    ).toLowerCase();
    const roleFilter = document.getElementById('collab-role-filter')?.value || 'all';
    const sort = document.getElementById('collab-sort')?.value || 'name-asc';
    const groupByRole = document.getElementById('collab-group-toggle')?.checked ?? true;

    let filtered = collaborators;

    if (this.currentStatusFilter !== 'all') {
      const wanted = this.currentStatusFilter === 'active';

      filtered = filtered.filter((c) => isActive(c) === wanted);
    }

    if (roleFilter !== 'all') {
      filtered = filtered.filter((c) => c.role === roleFilter);
    }

    if (q) {
      filtered = filtered.filter(
        (u) =>
          window.Utils.removeAccents(String(u.name || ''))
            .toLowerCase()
            .includes(q) ||
          window.Utils.removeAccents(String(u.badge || ''))
            .toLowerCase()
            .includes(q) ||
          window.Utils.removeAccents(String(u.role || ''))
            .toLowerCase()
            .includes(q)
      );
    }

    if (this.currentPendingFilter === 'pending') {
      filtered = filtered.filter((c) => this.getPendingTools(c.name).length > 0);
    }

    filtered.sort((a, b) => {
      switch (sort) {
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '', 'pt-BR');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '', 'pt-BR');
        case 'badge':
          return (a.badge || '').localeCompare(b.badge || '', 'pt-BR');
        case 'recent':
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        default:
          return 0;
      }
    });

    const activeFilters =
      (this.currentStatusFilter !== 'all' ? 1 : 0) +
      (this.currentPendingFilter !== 'all' ? 1 : 0) +
      (roleFilter !== 'all' ? 1 : 0) +
      (q ? 1 : 0);

    this._setMeta({
      count: `Mostrando ${Math.min(filtered.length, this.collabLimit)} de ${filtered.length} colaborador${filtered.length !== 1 ? 'es' : ''}`,
      filters: activeFilters
    });

    if (!filtered.length) {
      list.innerHTML = this._emptyStateHtml(collaborators.length > 0);

      if (loadMore) {
        loadMore.hidden = true;
      }

      return;
    }

    if (loadMore) {
      loadMore.hidden = filtered.length <= this.collabLimit;
    }

    const paginated = filtered.slice(0, this.collabLimit);

    list.innerHTML = this._isTableLayout()
      ? this.renderTableView(paginated, groupByRole)
      : this.renderCardsView(paginated, groupByRole);
    this._mountMenus(list);
  },

  // EMPTY: não há colaboradores. NO_RESULTS: há, mas nenhum atende à busca/filtros.
  _emptyStateHtml: function (hasCollaborators) {
    if (hasCollaborators) {
      return EmptyState({
        title: 'Nenhum colaborador encontrado',
        description: 'Nenhum colaborador corresponde à busca e aos filtros atuais.',
        icon: 'icon-search',
        action: Button({
          label: 'Limpar filtros',
          variant: 'secondary',
          attributes: { 'data-collab-action': 'clear-filters' }
        })
      });
    }

    const action = this._hasPermission('canManageCollaborators')
      ? Button({
        label: 'Novo colaborador',
        variant: 'secondary',
        icon: 'icon-plus',
        attributes: { 'data-collab-action': 'new' }
      })
      : '';

    return EmptyState({
      title: 'Nenhum colaborador cadastrado',
      description: 'Cadastre a equipe autorizada a retirar ferramentas no Scanner.',
      icon: 'icon-users',
      action
    });
  },

  // Agrupa na ordem já ordenada; os cargos saem em ordem alfabética e "Sem cargo" por último.
  _groupByRole: function (collaborators) {
    const groups = new Map();

    collaborators.forEach((c) => {
      const role = c.role || SEM_CARGO;

      if (!groups.has(role)) {
        groups.set(role, []);
      }

      groups.get(role).push(c);
    });

    return [...groups.entries()].sort(([a], [b]) => {
      if (a === SEM_CARGO) {
        return 1;
      }

      if (b === SEM_CARGO) {
        return -1;
      }

      return a.localeCompare(b, 'pt-BR');
    });
  },

  // Foto: clicável (amplia) quando existe; ícone decorativo quando não há.
  _avatar: function (c) {
    const name = esc(c.name || 'Sem nome');

    return c.imageUrl
      ? `<button type="button" class="collab-avatar" data-collab-action="preview" data-collab-name="${name}" aria-label="Ampliar foto de ${name}"><img src="${esc(c.imageUrl)}" alt="" loading="lazy" decoding="async"></button>`
      : `<span class="collab-avatar" aria-hidden="true">${icon('icon-users', 'ui-icon')}</span>`;
  },

  // Situação (StatusBadge, sempre com texto) + pendências em palavras.
  _statusCell: function (c) {
    const pending = this.getPendingTools(c.name).length;
    const flag = pending
      ? Badge({
        label: `${pending} ferramenta${pending !== 1 ? 's' : ''} em posse`,
        tone: 'warning'
      })
      : '';

    return `<div class="collab-status">${StatusBadge((c.status || 'active') === 'active' ? 'active' : 'inactive')}${flag}</div>`;
  },

  // Cobrança por WhatsApp: só com telefone E pendência (mesma regra e mesma mensagem de antes).
  _whatsappUrl: function (c, pending) {
    if (!c.phone || pending <= 0) {
      return '';
    }

    const rawPhone = String(c.phone).replace(/\D/g, '');

    if (!rawPhone) {
      return '';
    }

    const finalPhone = rawPhone.length <= 11 ? `55${rawPhone}` : rawPhone;
    const message = encodeURIComponent(
      `Olá ${String(c.name || '').split(' ')[0]}, consta no sistema do Almoxarifado que você possui ${pending} ferramenta(s) pendente(s) de devolução. Por favor, regularize assim que possível!`
    );

    return `https://wa.me/${finalPhone}?text=${message}`;
  },

  // Histórico fica visível para todo perfil que lê a tela (é a única ação comum aos dois); as demais
  // ficam no menu. Cada função continua validando a permissão ao executar: esconder não é a proteção.
  _actionsCell: function (c) {
    const id = esc(c.firebaseId);
    const name = esc(c.name || 'Sem nome');
    const canManage = this._hasPermission('canManageCollaborators');
    const inactive = (c.status || 'active') !== 'active';
    const whatsapp = this._whatsappUrl(c, this.getPendingTools(c.name).length);
    const item = (action, label, extra = '') =>
      `<button type="button" role="menuitem" class="ui-menu__item${extra}" data-collab-action="${action}" data-collab-id="${id}" data-collab-name="${name}">${esc(label)}</button>`;

    const primary = Button({
      label: 'Histórico',
      size: 'sm',
      variant: 'secondary',
      attributes: {
        'data-collab-action': 'history',
        'data-collab-name': name,
        'aria-label': `Histórico de ${c.name || 'Sem nome'}`
      }
    });

    let items = '';

    if (canManage) {
      items += item('edit', 'Editar');
      items += item('toggle-status', inactive ? 'Ativar' : 'Inativar');
    }

    if (whatsapp) {
      items += `<a role="menuitem" class="ui-menu__item" href="${esc(whatsapp)}" target="_blank" rel="noopener noreferrer">Cobrar no WhatsApp</a>`;
    }

    if (canManage) {
      items += '<hr class="ui-menu__sep" role="separator">';
      items += item('delete', 'Excluir', ' ui-menu__item--danger');
    }

    if (!items) {
      return `<div class="collab-actions-cell">${primary}</div>`;
    }

    const trigger = IconButton({
      label: `Mais ações de ${c.name || 'Sem nome'}`,
      icon: 'icon-more',
      attributes: { 'data-collab-menu-trigger': true }
    });

    return `<div class="collab-actions-cell">${primary}<div class="collab-menu" data-dropdown>${trigger}<div class="ui-menu" aria-label="Ações de ${name}">${items}</div></div></div>`;
  },

  _dash: function (label) {
    return `<span aria-hidden="true">—</span><span class="ui-sr-only">${esc(label)}</span>`;
  },

  _row: function (c, { withRole }) {
    const name = esc(c.name || 'Sem nome');

    return `<tr class="collab-row" data-collab-row data-collab-id="${esc(c.firebaseId)}"><th scope="row" class="collab-cell collab-cell--person"><div class="collab-person">${this._avatar(c)}<span class="collab-person__name">${name}</span></div></th><td class="collab-cell collab-cell--badge">${
      c.badge ? esc(c.badge) : this._dash('Sem crachá')
    }</td>${
      withRole ? `<td class="collab-cell">${c.role ? esc(c.role) : this._dash('Sem cargo')}</td>` : ''
    }<td class="collab-cell">${this._statusCell(c)}</td><td class="collab-cell">${
      c.phone ? esc(c.phone) : this._dash('Sem contato')
    }</td><td class="collab-cell collab-cell--actions">${this._actionsCell(c)}</td></tr>`;
  },

  // Desktop/notebook (>= 1024): tabela semântica para comparar a equipe lado a lado. Agrupada por
  // cargo, cada grupo é um <tbody> com um cabeçalho de grupo (e a coluna Cargo deixa de repetir).
  renderTableView: function (collaborators, groupByRole) {
    const withRole = !groupByRole;
    const columns = withRole ? 6 : 5;
    const head = `<thead><tr><th scope="col">Colaborador</th><th scope="col">Crachá</th>${
      withRole ? '<th scope="col">Cargo</th>' : ''
    }<th scope="col">Situação</th><th scope="col">Contato</th><th scope="col"><span class="ui-sr-only">Ações</span></th></tr></thead>`;

    const body = groupByRole
      ? this._groupByRole(collaborators)
        .map(
          ([role, members]) =>
            `<tbody class="collab-group"><tr class="collab-group__row"><th scope="rowgroup" colspan="${columns}" class="collab-group__cell"><span class="collab-group__name">${esc(role)}</span><span class="collab-group__count">${members.length}</span></th></tr>${members
              .map((c) => this._row(c, { withRole }))
              .join('')}</tbody>`
        )
        .join('')
      : `<tbody>${collaborators.map((c) => this._row(c, { withRole })).join('')}</tbody>`;

    return `<div class="ui-card collab-table-wrap"><table class="collab-table"><caption class="ui-sr-only">Lista de colaboradores</caption>${head}${body}</table></div>`;
  },

  // Agrupado, o cargo já está no título do grupo: a linha de identificação não o repete.
  _card: function (c, { withRole }) {
    const name = esc(c.name || 'Sem nome');
    const badge = c.badge ? esc(c.badge) : 'Sem crachá';
    const meta = withRole ? `${badge} · ${c.role ? esc(c.role) : SEM_CARGO}` : badge;

    return `<li class="ui-card collab-card" data-collab-row data-collab-id="${esc(c.firebaseId)}"><div class="collab-person">${this._avatar(c)}<div class="collab-person__text"><h4 class="collab-person__name">${name}</h4><span class="collab-person__meta">${meta}</span></div></div>${this._statusCell(c)}<dl class="collab-facts"><div class="collab-facts__row"><dt>Contato</dt><dd>${
      c.phone ? esc(c.phone) : this._dash('Sem contato')
    }</dd></div></dl>${this._actionsCell(c)}</li>`;
  },

  // Tablet/mobile (< 1024): cartões compactos, mesma informação e mesma ordem de leitura.
  renderCardsView: function (collaborators, groupByRole) {
    if (!groupByRole) {
      return `<ul class="collab-cards" role="list">${collaborators
        .map((c) => this._card(c, { withRole: true }))
        .join('')}</ul>`;
    }

    return this._groupByRole(collaborators)
      .map(
        ([role, members]) =>
          `<section class="collab-group-section" aria-label="${esc(role)}"><h3 class="collab-group__title"><span class="collab-group__name">${esc(role)}</span><span class="collab-group__count">${members.length}</span></h3><ul class="collab-cards" role="list">${members
            .map((c) => this._card(c, { withRole: false }))
            .join('')}</ul></section>`
      )
      .join('');
  },

  loadMore: function () {
    this.collabLimit += 30;
    this.render();
  },
  exportList: function () {
    if (!this._hasPermission('canExportData')) {
      this._denyAccess();
      return;
    }

    if (!window.XLSX) {
      window.App.UI.showToast('Carregando motor de planilhas...', 'info');
      window.Utils.loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js')
        .then(() => this.exportList())
        .catch(() => window.App.UI.showToast('Erro ao carregar motor.', 'error'));
      return;
    }

    const data = window.App.Data.collaborators.map((c) => ({
      Nome: c.name,
      Crachá: c.badge,
      Cargo: c.role,
    }));

    const ws = window.XLSX.utils.json_to_sheet(data);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Colaboradores');
    window.XLSX.writeFile(wb, `colaboradores_${new Date().toISOString().slice(0, 10)}.xlsx`);
    window.App.UI.showToast('Lista exportada com sucesso!', 'success');
  },

  bulkAction: async function (action) {
    if (action === 'export' && !this._hasPermission('canExportData')) {
      this._denyAccess();
      return;
    }

    if (action === 'delete' && !this._hasPermission('canManageCollaborators')) {
      this._denyAccess();
      return;
    }

    if (this.selectedCollabs.size === 0) {
      return;
    }
    const collabs = window.App.Data.collaborators.filter((c) =>
      this.selectedCollabs.has(c.firebaseId)
    );

    if (action === 'delete') {
      if (
        !(await window.App.UI.confirmDanger('Excluir colaboradores?', `Excluir permanentemente ${collabs.length} colaborador(es)?`))
      ) {
        return;
      }
      try {
        const promises = collabs.map((c) =>
          deleteDoc(doc(db, DB_BASE_PATH, COLLECTIONS.COLLABORATORS, c.firebaseId))
        );
        await Promise.all(promises);
        window.App.UI.showToast(`${collabs.length} colaborador(es) excluído(s).`, 'success');
        this.clearSelection();
      } catch (err) {
        window.Logger.error('Erro em ação em lote (excluir):', err);
      }
    } else if (action === 'export') {
      if (!window.XLSX) {
        window.App.UI.showToast('Carregando motor de planilhas...', 'info');
        window.Utils.loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js')
          .then(() => this.bulkAction('export'))
          .catch(() => window.App.UI.showToast('Erro ao carregar motor.', 'error'));
        return;
      }
      const data = collabs.map((c) => ({
        Nome: c.name,
        Crachá: c.badge,
        Cargo: c.role,
        Telefone: c.phone || '',
        Status: c.status === 'inactive' ? 'Inativo' : 'Ativo',
      }));
      const ws = window.XLSX.utils.json_to_sheet(data);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Selecionados');
      window.XLSX.writeFile(
        wb,
        `colaboradores_selecionados_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      window.App.UI.showToast(`${collabs.length} exportado(s).`, 'success');
    }
  },

  toggleStatus: async function (id) {
    if (!this._hasPermission('canManageCollaborators')) {
      this._denyAccess();
      return;
    }

    const c = window.App.Data.collaborators.find((x) => x.firebaseId === id);
    if (!c) {
      return;
    }
    const newStatus = (c.status || 'active') === 'active' ? 'inactive' : 'active';
    try {
      await updateDoc(doc(db, DB_BASE_PATH, COLLECTIONS.COLLABORATORS, id), { status: newStatus });
      window.App.UI.showToast(
        `Colaborador ${newStatus === 'active' ? 'ativado' : 'bloqueado'} com sucesso.`,
        'success'
      );
    } catch (e) {
      window.Logger.error('Erro ao alterar status de colaborador.', e);
    }
  },

  showHistory: function (collabName) {
    const modal = document.getElementById('collab-history-modal');
    const list = document.getElementById('collab-history-list');
    const title = document.getElementById('collab-history-name');
    if (!modal || !list || !title) {
      return;
    }

    title.textContent = collabName;

    const logs = (window.App.Data.allHistoryLogs || []).filter((l) => l.user === collabName);
    logs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    if (logs.length === 0) {
      list.innerHTML = EmptyState({
        title: 'Nenhuma movimentação registrada',
        description: 'Este colaborador ainda não retirou nem devolveu ferramentas.',
        icon: 'icon-history'
      });
    } else {
      // Cada registro traz o tipo em palavras (StatusBadge), a ferramenta, o patrimônio e a data.
      list.innerHTML = `<ul class="collab-history" role="list">${logs
        .map((log) => {
          const logType = String(log.type || '').toLowerCase();
          const known = logType === 'in' || logType === 'out';

          return `<li class="ui-card collab-history__item"><div class="collab-history__head">${
            known
              ? StatusBadge(logType)
              : Badge({ label: String(log.type || 'Registro') })
          }<span class="collab-history__date">${window.Utils.escapeHTML(window.Utils.formatDate(log.date))}</span></div><p class="collab-history__tool">${window.Utils.escapeHTML(
            log.toolName || 'Desconhecida'
          )}</p><p class="collab-history__code">${window.Utils.escapeHTML(log.toolCode || '-')}</p></li>`;
        })
        .join('')}</ul>`;
    }

    modal.showModal();
  },

  closeHistoryModal: function () {
    const m = document.getElementById('collab-history-modal');
    if (m) {
      m.close();
    }
  },

  initImagePreview: function () {
    if (this.imagePreviewInitialized) {
      return;
    }

    const imageInput = document.getElementById('crud-collab-image');
    if (!imageInput) {
      return;
    }

    imageInput.addEventListener('change', (event) => this.previewSelectedImage(event));
    this.imagePreviewInitialized = true;
  },

  ensureImagePreviewInitialized: function () {
    if (this.imagePreviewInitialized) {
      return;
    }

    if (typeof document === 'undefined') {
      return;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initImagePreview(), { once: true });
      return;
    }

    this.initImagePreview();
  },

  previewSelectedImage: function (event) {
    const input = event?.target || document.getElementById('crud-collab-image');
    const file = input?.files?.[0];
    const preview = document.getElementById('crud-collab-image-preview');
    const iconEl = document.getElementById('collab-image-icon');

    if (!file || !preview || !iconEl) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      input.value = '';
      window.App.UI.showToast('Selecione um arquivo de imagem válido.', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      preview.src = String(reader.result || '');
      preview.classList.remove('hidden');
      iconEl.classList.add('hidden');
    };
    reader.onerror = () => {
      input.value = '';
      window.App.UI.showToast('Não foi possível carregar a prévia da foto.', 'error');
    };
    reader.readAsDataURL(file);
  },

  openModal: function (id = null) {
    if (!this._hasPermission('canManageCollaborators')) {
      this._denyAccess();
      return;
    }

    const m = document.getElementById('crud-collab-modal');
    const pre = document.getElementById('crud-collab-image-preview');
    const iconEl = document.getElementById('collab-image-icon');
    if (m) {
      m.showModal();
    }
    const imageInput = document.getElementById('crud-collab-image');
    this.ensureImagePreviewInitialized();
    imageInput.value = '';
    if (pre) {
      pre.classList.add('hidden');
      pre.src = '';
    }
    if (iconEl) {
      iconEl.classList.remove('hidden');
    }
    if (id) {
      const u = window.App.Data.collaborators.find((x) => x.firebaseId === id);
      document.getElementById('collab-modal-title').textContent = 'Editar colaborador';
      document.getElementById('crud-collab-id').value = u.firebaseId;
      document.getElementById('crud-collab-badge').value = u.badge || '';
      document.getElementById('crud-collab-name').value = u.name;
      document.getElementById('crud-collab-role').value = u.role || '';
      document.getElementById('crud-collab-phone').value = u.phone || '';
      if (u.imageUrl && pre && iconEl) {
        pre.src = u.imageUrl;
        pre.classList.remove('hidden');
        iconEl.classList.add('hidden');
      }
    } else {
      document.getElementById('collab-modal-title').textContent = 'Novo colaborador';
      document.getElementById('crud-collab-id').value = '';
      document.getElementById('crud-collab-badge').value = '';
      document.getElementById('crud-collab-name').value = '';
      document.getElementById('crud-collab-role').value = '';
      document.getElementById('crud-collab-phone').value = '';
    }

    // Abertura limpa: nenhum erro do envio anterior e foco no primeiro campo (não no "Fechar").
    ['crud-collab-badge', 'crud-collab-name'].forEach((field) => this._setFieldError(field, ''));
    setBusy(document.getElementById('btn-save-collab'), false);
    document.getElementById('crud-collab-badge')?.focus();
  },
  closeModal: () => {
    const m = document.getElementById('crud-collab-modal');
    if (m) {
      m.close();
    }
  },
  saveCollaborator: async function () {
    if (!this._hasPermission('canManageCollaborators')) {
      this._denyAccess();
      return;
    }

    const id = document.getElementById('crud-collab-id').value,
      b = document.getElementById('crud-collab-badge').value.trim(),
      n = document.getElementById('crud-collab-name').value.trim(),
      r = document.getElementById('crud-collab-role').value.trim(),
      p = document.getElementById('crud-collab-phone').value.trim(),
      file = document.getElementById('crud-collab-image');

    const btn = document.getElementById('btn-save-collab');

    // Envio duplo: o botão fica ocupado (sem perder o foco) e o segundo clique é ignorado.
    if (isBusy(btn)) {
      return;
    }

    this._setFieldError('crud-collab-badge', '');
    this._setFieldError('crud-collab-name', '');

    // Mesmas regras e mesmas mensagens de domínio de antes; agora também junto do campo.
    if (!n || !b) {
      if (!b) {
        this._setFieldError('crud-collab-badge', 'Informe o crachá / ponto.');
      }

      if (!n) {
        this._setFieldError('crud-collab-name', 'Informe o nome.');
      }

      (b ? document.getElementById('crud-collab-name') : document.getElementById('crud-collab-badge'))?.focus();

      return window.App.UI.showToast('Os campos Nome e Cracha/Ponto são obrigatórios.', 'warning');
    }
    if (
      window.App.Data.collaborators.some(
        (u) =>
          u.firebaseId !== id &&
          u.badge &&
          String(u.badge).toLowerCase() === String(b).toLowerCase()
      )
    ) {
      this._setFieldError('crud-collab-badge', 'Este crachá / ponto já está cadastrado.');
      document.getElementById('crud-collab-badge')?.focus();

      return window.App.UI.showToast('Cracha/Ponto já cadastrado.', 'warning');
    }

    setBusy(btn, true);
    try {
      if (!auth.currentUser) {
        throw new Error('Sessão inválida ou expirada.');
      }
      if (!db) {
        throw new Error('Banco de dados não inicializado.');
      }

      let imgUrl = null;
      const collab = id ? window.App.Data.collaborators.find((c) => c.firebaseId === id) : null;
      if (collab && collab.imageUrl) {
        imgUrl = collab.imageUrl;
      }
      if (file && file.files.length > 0) {
        imgUrl = await window.Utils.compressImageToBase64(file.files[0]);
      }

      if (id) {
        await window.Utils.withTimeout(
          updateDoc(doc(db, DB_BASE_PATH, COLLECTIONS.COLLABORATORS, id), {
            badge: b,
            name: n,
            role: r,
            phone: p,
            imageUrl: imgUrl,
          }),
          CONFIG.TIMEOUT_MS,
          'Tempo excedido ao atualizar colaborador.'
        );
      } else {
        await window.Utils.withTimeout(
          addDoc(collection(db, DB_BASE_PATH, COLLECTIONS.COLLABORATORS), {
            badge: b,
            name: n,
            role: r,
            phone: p,
            status: 'active',
            imageUrl: imgUrl,
          }),
          CONFIG.TIMEOUT_MS,
          'Tempo excedido ao salvar colaborador.'
        );
      }
      window.App.UI.showToast('Salvo com sucesso.', 'success');
      this.closeModal();
    } catch (e) {
      window.Logger.error('Erro ao salvar.', e);
    } finally {
      setBusy(btn, false);
    }
  },
  deleteCollaborator: async function (id) {
    if (!this._hasPermission('canManageCollaborators')) {
      this._denyAccess();
      return;
    }

    if (
      await window.App.UI.confirmDanger('Excluir colaborador?', 'Excluir este colaborador?')
    ) {
      try {
        await deleteDoc(doc(db, DB_BASE_PATH, COLLECTIONS.COLLABORATORS, id));
        window.App.UI.showToast('Removido com sucesso.', 'success');
      } catch (e) {
        window.Logger.error('Erro ao remover.', e);
      }
    }
  },
  importFile: async function (e) {
    if (!this._hasPermission('canManageCollaborators')) {
      if (e?.target) {
        e.target.value = '';
      }

      this._denyAccess();
      return;
    }

    if (!e || !e.target || !e.target.files) {
      return;
    }
    if (!window.XLSX) {
      window.App.UI.showToast('Carregando motor de Excel...', 'info');
      try {
        await window.Utils.loadScript(
          'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
        );
      } catch {
        e.target.value = '';
        return window.App.UI.showToast('Erro ao carregar o motor.', 'error');
      }
    }
    const f = e.target.files[0];
    if (!f) {
      return;
    }
    const r = new FileReader();
    r.onload = async (ev) => {
      try {
        const wb = window.XLSX.read(new Uint8Array(ev.target.result), {
          type: 'array',
        });
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
          header: 1,
        });
        if (rows.length < 2) {
          return window.App.UI.showToast('Arquivo vazio ou inválido.', 'error');
        }
        window.App.UI.showToast('Importando lista... Aguarde.', 'info');
        let c = 0,
          dup = 0;
        const eN = new Set(
          window.App.Data.collaborators.map((u) => String(u.name || '').toLowerCase())
        );
        const eB = new Set(
          window.App.Data.collaborators.map((u) => String(u.badge || '')).filter((b) => b)
        );
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          if (!cols || cols.length === 0) {
            continue;
          }
          const b = cols[0] !== null && cols[0] !== undefined ? String(cols[0]).trim() : '',
            n = cols[1] !== null && cols[1] !== undefined ? String(cols[1]).trim() : '',
            rl = cols[2] !== null && cols[2] !== undefined ? String(cols[2]).trim() : '';
          if (n) {
            const lN = n.toLowerCase();
            if (eN.has(lN) || (b && eB.has(b))) {
              dup++;
              continue;
            }
            eN.add(lN);
            if (b) {
              eB.add(b);
            }
            try {
              await addDoc(collection(db, DB_BASE_PATH, COLLECTIONS.COLLABORATORS), {
                badge: b,
                name: n,
                role: rl,
              });
              c++;
            } catch (err) {
              window.Logger.warn(`Erro ao importar colaborador ${n}:`, err?.message);
            }
          }
        }
        window.App.UI.showToast(
          `${c} registros importados. ${dup > 0 ? `(${dup} ignorados)` : ''}`,
          'success'
        );
      } catch {
        window.App.UI.showToast('Falha ao ler Excel.', 'error');
      } finally {
        e.target.value = '';
      }
    };
    r.readAsArrayBuffer(f);
  },
};

if (typeof document !== 'undefined') {
  AppCRUDCollaborators.ensureImagePreviewInitialized();
}
