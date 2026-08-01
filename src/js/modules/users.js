import { auth } from '../app.js';

async function requestUsersApi(endpoint, method, body) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error('Sua sessão expirou. Entre novamente.');
  }

  const token = await currentUser.getIdToken();

  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  let payload;

  try {
    payload = await response.json();
  } catch {
    throw new Error('A API retornou uma resposta inválida.');
  }

  if (!response.ok || payload?.success !== true) {
    throw new Error(
      payload?.message ||
        'Não foi possível concluir a operação com o usuário.'
    );
  }

  return payload;
}

export const AppCRUDUsers = {
  currentAccessFilter: 'all',
  currentSort: 'name',
  currentSortOrder: 'asc',
  currentPage: 1,
  itemsPerPage: 9,
  selectedUsers: new Set(),

  toggleSelection: function (id) {
    if (this.selectedUsers.has(id)) {
      this.selectedUsers.delete(id);
    } else {
      this.selectedUsers.add(id);
    }
    this.updateBulkBar();
    this.render();
  },

  clearSelection: function () {
    this.selectedUsers.clear();
    this.updateBulkBar();
    this.render();
  },

  updateBulkBar: function () {
    const bar = document.getElementById('users-bulk-actions-bar');
    const count = document.getElementById('users-bulk-selected-count');
    if (bar && count) {
      if (this.selectedUsers.size > 0) {
        bar.classList.remove('hidden');
        bar.classList.add('flex');
        count.textContent = this.selectedUsers.size;
      } else {
        bar.classList.add('hidden');
        bar.classList.remove('flex');
      }
    }
  },

  bulkAction: async function (action) {
    if (this.selectedUsers.size === 0) {
      return;
    }

    const users = window.App.Data.users.filter(
      (user) => this.selectedUsers.has(user.firebaseId)
    );

    if (users.length === 0) {
      this.clearSelection();
      return;
    }

    const allowedActions = new Set([
      'activate',
      'deactivate',
      'delete'
    ]);

    if (!allowedActions.has(action)) {
      window.App.UI.showToast(
        'Ação em lote inválida.',
        'error'
      );
      return;
    }

    if (
      action === 'delete' &&
      !confirm(
        `Excluir definitivamente ${users.length} usuário(s)?`
      )
    ) {
      return;
    }

    const successfulIds = [];
    const failures = [];

    for (const user of users) {
      try {
        if (action === 'delete') {
          await requestUsersApi(
            '/api/users/delete',
            'POST',
            {
              uid: user.firebaseId
            }
          );
        } else {
          await requestUsersApi(
            '/api/users/status',
            'POST',
            {
              uid: user.firebaseId,
              status:
                action === 'activate'
                  ? 'Ativo'
                  : 'Inativo'
            }
          );
        }

        successfulIds.push(user.firebaseId);
      } catch (error) {
        failures.push({
          user,
          error
        });
      }
    }

    successfulIds.forEach((id) => {
      this.selectedUsers.delete(id);
    });

    if (successfulIds.length > 0) {
      window.App.UI.showToast(
        `Ação concluída para ${successfulIds.length} usuário(s).`,
        'success'
      );
    }

    if (failures.length > 0) {
      window.Logger.error(
        'Falhas na ação em lote de usuários:',
        failures
      );

      const firstMessage =
        failures[0].error?.message ||
        'Não foi possível processar todos os usuários.';

      window.App.UI.showToast(
        `${failures.length} usuário(s) não processado(s). ${firstMessage}`,
        'error'
      );
    }

    if (failures.length === 0) {
      this.clearSelection();
      return;
    }

    this.updateBulkBar();
    this.render();
  },

  getAccessLevel: function (u) {
    return u.accessLevel || (u.role === 'Administrador' ? 'Administrador' : 'Usuário Padrão');
  },
  getStatus: function (u) {
    return u.status || 'Ativo';
  },
  getInitials: function (name) {
    if (!name) {
      return '??';
    }
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  },
  getFilteredUsers: function () {
    const q = window.Utils.removeAccents(
      document.getElementById('users-search')?.value || ''
    ).toLowerCase();

    let filtered = window.App.Data.users.filter((u) => {
      const accessLevel = this.getAccessLevel(u);
      const status = this.getStatus(u);
      const nameMatch = window.Utils.removeAccents(String(u.name || ''))
        .toLowerCase()
        .includes(q);
      const emailMatch = window.Utils.removeAccents(String(u.email || ''))
        .toLowerCase()
        .includes(q);
      const accessMatch = window.Utils.removeAccents(String(accessLevel)).toLowerCase().includes(q);
      const statusMatch = window.Utils.removeAccents(String(status)).toLowerCase().includes(q);
      const deptMatch = window.Utils.removeAccents(String(u.department || ''))
        .toLowerCase()
        .includes(q);

      return nameMatch || emailMatch || accessMatch || statusMatch || deptMatch;
    });

    // Aplicar filtro de acesso
    if (this.currentAccessFilter === 'Administrador') {
      filtered = filtered.filter((u) => this.getAccessLevel(u) === 'Administrador');
    } else if (this.currentAccessFilter === 'Usuário Padrão') {
      filtered = filtered.filter((u) => this.getAccessLevel(u) === 'Usuário Padrão');
    } else if (this.currentAccessFilter === 'Ativo') {
      filtered = filtered.filter((u) => this.getStatus(u) === 'Ativo');
    } else if (this.currentAccessFilter === 'Inativo') {
      filtered = filtered.filter((u) => this.getStatus(u) === 'Inativo');
    }

    return filtered;
  },
  setSort: function (sortBy) {
    if (this.currentSort === sortBy) {
      this.currentSortOrder = this.currentSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.currentSort = sortBy;
      this.currentSortOrder = 'asc';
    }
    // Reset para página 1 quando ordenação muda
    this.currentPage = 1;

    // Atualizar indicadores visuais
    document.querySelectorAll('.sort-indicator').forEach((el) => {
      el.textContent = '';
      el.className = 'sort-indicator';
    });

    const activeIndicator = document.querySelector(
      `.sort-btn[data-sort="${sortBy}"] .sort-indicator`
    );
    if (activeIndicator) {
      activeIndicator.textContent = this.currentSortOrder === 'asc' ? ' ↑' : ' ↓';
      activeIndicator.className = 'sort-indicator active';
    }

    // Atualizar estilo dos botões
    document.querySelectorAll('.sort-btn').forEach((btn) => {
      const sortValue = btn.dataset.sort;
      if (sortValue === this.currentSort) {
        btn.classList.add('active-sort');
      } else {
        btn.classList.remove('active-sort');
      }
    });

    this.render();
  },
  getSortedUsers: function (users) {
    const sorted = [...users];
    const order = this.currentSortOrder === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      switch (this.currentSort) {
        case 'name':
          return order * String(a.name || '').localeCompare(String(b.name || ''));
        case 'email':
          return order * String(a.email || '').localeCompare(String(b.email || ''));
        case 'lastLogin': {
          const loginA = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
          const loginB = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
          return order * (loginB - loginA);
        }
        case 'status': {
          const statusA = this.getStatus(a);
          const statusB = this.getStatus(b);
          return order * String(statusA).localeCompare(String(statusB));
        }
        default:
          return 0;
      }
    });

    return sorted;
  },
  getPaginatedUsers: function (users) {
    const totalPages = Math.ceil(users.length / this.itemsPerPage);
    const start = (this.currentPage - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    return {
      users: users.slice(start, end),
      totalPages: totalPages,
      totalItems: users.length
    };
  },
  setPage: function (page) {
    this.currentPage = page;
    this.render();
  },
  formatLastLogin: function (value) {
    if (!value) {
      return 'Sem registro';
    }
    let d = value;
    if (typeof value?.toDate === 'function') {
      d = value.toDate();
    } else if (typeof value === 'object' && value !== null && typeof value.seconds === 'number') {
      d = new Date(value.seconds * 1000);
    } else {
      d = new Date(value);
    }
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
      return 'Sem registro';
    }
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  },
  isProtectedUser: function (u) {
    const email = String(u.email || '')
      .trim()
      .toLowerCase();
    const currentEmail = String(auth.currentUser?.email || '')
      .trim()
      .toLowerCase();
    return email !== '' && email === currentEmail;
  },
  updateCounters: function () {
    const users = window.App.Data.users;
    const total = users.length;
    const active = users.filter((u) => this.getStatus(u) === 'Ativo').length;
    const admins = users.filter((u) => this.getAccessLevel(u) === 'Administrador').length;
    const regularUsers = users.filter((u) => this.getAccessLevel(u) === 'Usuário Padrão').length;

    const totalEl = document.getElementById('count-total');
    const activeEl = document.getElementById('count-active');
    const adminsEl = document.getElementById('count-admins');
    const usersEl = document.getElementById('count-users');

    if (totalEl) {
      totalEl.textContent = total;
    }
    if (activeEl) {
      activeEl.textContent = active;
    }
    if (adminsEl) {
      adminsEl.textContent = admins;
    }
    if (usersEl) {
      usersEl.textContent = regularUsers;
    }
  },
  setAccessFilter: function (filter) {
    this.currentAccessFilter = filter;

    document.querySelectorAll('#users-filters .filter-btn').forEach((btn) => {
      const filterValue = btn.dataset.filter;
      if (filterValue === filter) {
        btn.classList.add('active');
        btn.className =
          'filter-btn active px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border bg-brand-600 text-white border-brand-600';
      } else {
        btn.classList.remove('active');
        btn.className =
          'filter-btn px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300';
      }
    });

    this.render();
  },
  applyFilters: function () {
    this.currentPage = 1;
    clearTimeout(this._filterTimeout);
    this._filterTimeout = setTimeout(() => {
      this.render();
    }, 300);
  },
  render: function () {
    const list =
      window.App.UI.domCache?.usersList || document.getElementById('user-management-body');
    if (!list) {
      return;
    }
    if (!window.App.Data.usersLoaded) {
      list.innerHTML = Array(6).fill(window.Utils.getSkeletonHTML()).join('');
      return;
    }

    this.updateCounters();

    const filtered = this.getFilteredUsers();
    const sorted = this.getSortedUsers(filtered);
    const paginated = this.getPaginatedUsers(sorted);

    if (!paginated.users.length) {
      list.innerHTML = this.getEnhancedEmptyState();
      return;
    }
    list.innerHTML = paginated.users
      .map((u, idx) => {
        const accessLevel = this.getAccessLevel(u);
        const status = this.getStatus(u);
        const safeName = window.Utils.escapeHTML(u.name || 'Sem nome');
        const safeEmail = window.Utils.escapeHTML(u.email || 'Sem e-mail');
        const initials = this.getInitials(u.name || '??');
        const isProtected = this.isProtectedUser(u);
        const isAdmin = accessLevel === 'Administrador';
        const isActive = status === 'Ativo';
        const dotColor = isActive ? 'bg-emerald-500' : 'bg-rose-500';
        const disabledAttr = isProtected ? 'disabled' : '';
        const roleBadge = isAdmin
          ? 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800'
          : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
        const statusBadge = isActive
          ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800'
          : 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800';
        const statusBtnHoverCls = isActive
          ? 'hover:bg-rose-50 dark:hover:bg-rose-900/30 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-200 dark:hover:border-rose-800'
          : 'hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-200 dark:hover:border-emerald-800';
        const avatarBg = isAdmin
          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
          : 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400';

        const loginDetails = u.lastLogin
          ? `
          <div class="space-y-1 mt-1">
            ${
  u.lastIp
    ? `<div class="flex items-center gap-1 text-[9px] text-slate-400" title="Endereço IP do dispositivo">
              <svg class="w-3 h-3 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 18H2"/><path d="M18 18h4"/><path d="M6 14v4"/><path d="M18 14v4"/></svg>
              <span class="truncate">${window.Utils.escapeHTML(u.lastIp)}</span>
            </div>`
    : ''
}
            ${
  u.lastDevice
    ? `<div class="flex items-center gap-1 text-[9px] text-slate-400" title="Dispositivo utilizado no login">
              <svg class="w-3 h-3 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/></svg>
              <span class="truncate">${window.Utils.escapeHTML(u.lastDevice)}</span>
            </div>`
    : ''
}
          </div>
        `
          : '';

        return `<div class="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-5 flex flex-col gap-4 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group animate-fade-in opacity-0" style="animation-delay: ${Math.min(idx * 30, 500)}ms; animation-fill-mode: forwards;">
          <div class="absolute top-0 left-0 w-1 h-full ${dotColor} opacity-75" title="Indicador visual de status"></div>
          <div class="flex items-start gap-4 pl-2">
            <div class="w-12 h-12 rounded-xl ${avatarBg} flex items-center justify-center shrink-0 font-bold text-sm" title="${safeName}">${initials}</div>
            <div class="flex-1 min-w-0">
              <h3 class="font-extrabold text-slate-900 dark:text-white text-sm sm:text-base leading-tight truncate" title="Nome completo">${safeName}</h3>
              <p class="text-[11px] font-medium text-slate-500 truncate mt-0.5" title="Endereço de email">${safeEmail}</p>
            </div>
          </div>
          <div class="border-t border-slate-100 dark:border-slate-800 ml-2"></div>
          <div class="flex flex-col gap-3 pl-2">
            <div class="flex justify-between items-center">
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest" title="Nível de acesso do usuário"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-0.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Acesso</span>
              <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-bold border uppercase tracking-wider ${roleBadge}" title="Nível de permissão">${window.Utils.escapeHTML(accessLevel)}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest" title="Status atual do usuário"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-0.5"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg> Status</span>
              <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-bold border uppercase tracking-wider ${statusBadge}" title="Status ativo ou inativo">${window.Utils.escapeHTML(status)}</span>
            </div>
            <div class="flex justify-between items-start gap-4 mt-1">
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest" title="Informações detalhadas do último login"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-0.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Último Login</span>
              <div class="text-right flex flex-col items-end">
                <div class="text-[10px] font-bold text-slate-600 dark:text-slate-300" title="Data e hora exata do último acesso">${this.formatLastLogin(u.lastLogin)}</div>
                ${loginDetails}
              </div>
            </div>
          </div>
          <div class="flex gap-1.5 mt-2">
            <button onclick="App.CRUDUsers.openModal('${u.firebaseId}')" class="flex-1 py-2 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center justify-center shadow-sm disabled:opacity-50 disabled:cursor-not-allowed" title="Editar dados do usuário">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
            </button>
            <button onclick="App.CRUDUsers.toggleRole('${u.firebaseId}')" ${disabledAttr} class="flex-1 py-2 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-600 dark:hover:text-brand-400 hover:border-brand-200 dark:hover:border-brand-800 transition-colors flex items-center justify-center shadow-sm disabled:opacity-50 disabled:cursor-not-allowed" title="Alterar permissão de acesso">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
            </button>
            <button onclick="App.CRUDUsers.toggleStatus('${u.firebaseId}')" ${disabledAttr} class="flex-1 py-2 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 ${statusBtnHoverCls} transition-colors flex items-center justify-center shadow-sm disabled:opacity-50 disabled:cursor-not-allowed" title="${isActive ? 'Desativar conta' : 'Ativar conta'}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">${isActive ? '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" x2="22" y1="8" y2="13"/><line x1="22" x2="17" y1="8" y2="13"/>' : '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>'}</svg>
            </button>
            <button onclick="App.CRUDUsers.deleteUser('${u.firebaseId}')" ${disabledAttr} class="flex-1 py-2 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-900/30 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-200 dark:hover:border-rose-800 transition-colors flex items-center justify-center shadow-sm disabled:opacity-50 disabled:cursor-not-allowed" title="Excluir permanentemente">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>`;
      })
      .join(' ');

    if (paginated.totalPages > 1) {
      list.innerHTML += this.getPaginationHTML(paginated.totalPages);
    }
  },
  getPaginationHTML: function (totalPages) {
    const currentPage = this.currentPage;
    const pages = [];
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    return `
      <div class="col-span-full flex items-center justify-center gap-2 mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
        <button onclick="App.CRUDUsers.setPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="px-3 py-2 rounded-xl text-xs font-semibold transition-all border bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-200">
          ← Anterior
        </button>
        ${startPage > 1 ? `<button onclick="App.CRUDUsers.setPage(1)" class="px-3 py-2 rounded-xl text-xs font-semibold border bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300">1</button>${pages[0] > 2 ? '<span class="text-slate-400 px-2">...</span>' : ''}` : ''}
        ${pages
    .map(
      (p) => `
          <button onclick="App.CRUDUsers.setPage(${p})" class="px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${p === currentPage ? 'bg-brand-600 text-white border-brand-600' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300'}">
            ${p}
          </button>
        `
    )
    .join('')}
        ${endPage < totalPages ? `${pages[pages.length - 1] < totalPages - 1 ? '<span class="text-slate-400 px-2">...</span>' : ''}<button onclick="App.CRUDUsers.setPage(${totalPages})" class="px-3 py-2 rounded-xl text-xs font-semibold border bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300">${totalPages}</button>` : ''}
        <button onclick="App.CRUDUsers.setPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="px-3 py-2 rounded-xl text-xs font-semibold transition-all border bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-brand-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-200">
          Próximo →
        </button>
      </div>
    `;
  },
  openModal: function (id = null) {
    const m = document.getElementById('crud-user-modal');
    if (m) {
      m.showModal();
    }
    const subtitle = document.getElementById('user-modal-subtitle');
    const saveText = document.getElementById('btn-save-user-text');
    if (id) {
      const u = window.App.Data.users.find((x) => x.firebaseId === id);
      document.getElementById('user-modal-title').textContent = 'Editar Usuário';
      if (subtitle) {
        subtitle.textContent = 'Atualize os dados cadastrais e o nivel de acesso.';
      }
      if (saveText) {
        saveText.textContent = 'Salvar';
      }
      document.getElementById('crud-user-id').value = u.firebaseId;
      document.getElementById('crud-user-name').value = u.name;
      document.getElementById('crud-user-email').value = u.email || '';
      document.getElementById('crud-user-department').value = u.department || '';
      document.getElementById('crud-user-access').value = u.accessLevel || 'Usuário Padrão';
    } else {
      document.getElementById('user-modal-title').textContent = 'Novo Usuário';
      if (subtitle) {
        subtitle.textContent = 'Cadastre um novo colaborador no sistema';
      }
      if (saveText) {
        saveText.textContent = 'Cadastrar';
      }
      document.getElementById('crud-user-id').value = '';
      document.getElementById('crud-user-name').value = '';
      document.getElementById('crud-user-email').value = '';
      document.getElementById('crud-user-department').value = '';
      document.getElementById('crud-user-access').value = 'Usuário Padrão';
    }
  },
  closeModal: () => {
    const m = document.getElementById('crud-user-modal');
    if (m) {
      m.close();
    }
  },
  saveUser: async function () {
    const id = document.getElementById('crud-user-id').value,
      n = document.getElementById('crud-user-name').value.trim(),
      e = document.getElementById('crud-user-email').value.trim().toLowerCase(),
      d = document.getElementById('crud-user-department').value.trim(),
      a = document.getElementById('crud-user-access').value;

    if (!n || !e) {
      return window.App.UI.showToast(
        'Os campos Nome e E-mail são obrigatórios.',
        'warning'
      );
    }

    if (
      window.App.Data.users.some(
        (u) =>
          u.firebaseId !== id &&
          u.email &&
          String(u.email).toLowerCase() === String(e).toLowerCase()
      )
    ) {
      return window.App.UI.showToast(
        'E-mail já cadastrado.',
        'warning'
      );
    }

    try {
      const body = {
        name: n,
        email: e,
        department: d,
        accessLevel: a
      };

      if (id) {
        body.uid = id;
      }

      const result = await requestUsersApi(
        id ? '/api/users/update' : '/api/users/create',
        id ? 'PATCH' : 'POST',
        body
      );

      let successMessage =
        result.message ||
        (id
          ? 'Usuário atualizado com sucesso.'
          : 'Usuário cadastrado com sucesso.');
      let toastType = 'success';

      if (!id) {
        try {
          await window.App.Auth.sendPasswordAccessEmail(e);

          successMessage =
            'Usuário cadastrado e instruções de acesso enviadas.';
        } catch (accessError) {
          successMessage =
            'Usuário cadastrado, mas não foi possível enviar as instruções de acesso.';
          toastType = 'warning';

          window.Logger.warn(
            'Usuário criado sem envio das instruções de acesso.',
            accessError
          );
        }
      }

      window.App.UI.showToast(
        successMessage,
        toastType
      );

      this.closeModal();
    } catch (error) {
      window.Logger.error(
        'Erro ao salvar usuário.',
        error
      );

      window.App.UI.showToast(
        error?.message ||
          'Não foi possível salvar o usuário.',
        'error'
      );
    }
  },
  toggleRole: async function (id) {
    const user = window.App.Data.users.find(
      (item) => item.firebaseId === id
    );

    if (!user) {
      return;
    }

    const currentAccess = this.getAccessLevel(user);
    const newAccess =
      currentAccess === 'Administrador'
        ? 'Usuário Padrão'
        : 'Administrador';

    try {
      const result = await requestUsersApi(
        '/api/users/update',
        'PATCH',
        {
          uid: id,
          name: String(user.name || '').trim(),
          email: String(user.email || '').trim().toLowerCase(),
          department: String(user.department || '').trim(),
          accessLevel: newAccess
        }
      );

      window.App.UI.showToast(
        result.message ||
          `Nível de acesso alterado para ${newAccess}.`,
        'success'
      );
    } catch (error) {
      window.Logger.error(
        'Erro ao alterar permissão.',
        error
      );

      window.App.UI.showToast(
        error?.message ||
          'Não foi possível alterar o nível de acesso.',
        'error'
      );
    }
  },
  toggleStatus: async function (id) {
    const user = window.App.Data.users.find(
      (item) => item.firebaseId === id
    );

    if (!user) {
      return;
    }

    const newStatus =
      this.getStatus(user) === 'Inativo'
        ? 'Ativo'
        : 'Inativo';

    const actionText =
      newStatus === 'Ativo'
        ? 'ativar'
        : 'desativar';

    const button = window.event?.target?.closest?.('button');

    if (button) {
      button.classList.add('animate-pulse');
      button.disabled = true;
    }

    try {
      const result = await requestUsersApi(
        '/api/users/status',
        'POST',
        {
          uid: id,
          status: newStatus
        }
      );

      window.AudioSys.playBeep(
        newStatus === 'Ativo'
          ? 'success'
          : 'error'
      );

      window.App.UI.showToast(
        result.message ||
          `Usuário ${
            newStatus === 'Ativo'
              ? 'ativado'
              : 'desativado'
          } com sucesso.`,
        'success'
      );
    } catch (error) {
      window.Logger.error(
        `Erro ao ${actionText} usuário.`,
        error
      );

      window.App.UI.showToast(
        error?.message ||
          `Não foi possível ${actionText} o usuário.`,
        'error'
      );
    } finally {
      if (button) {
        button.classList.remove('animate-pulse');
        button.disabled = false;
      }
    }
  },
  deleteUser: async function (id) {
    const user = window.App.Data.users.find(
      (item) => item.firebaseId === id
    );

    if (!user) {
      return;
    }

    const identification = String(
      user.name || user.email || id
    ).trim();

    const confirmed = confirm(
      `Excluir definitivamente o usuário "${identification}"?`
    );

    if (!confirmed) {
      return;
    }

    try {
      const result = await requestUsersApi(
        '/api/users/delete',
        'POST',
        {
          uid: id
        }
      );

      this.selectedUsers.delete(id);

      window.App.UI.showToast(
        result.message ||
          'Usuário excluído com sucesso.',
        'success'
      );
    } catch (error) {
      window.Logger.error(
        'Erro ao excluir usuário.',
        error
      );

      window.App.UI.showToast(
        error?.message ||
          'Não foi possível excluir o usuário.',
        'error'
      );
    }
  },
  importFile: async function (e) {
    if (!e || !e.target || !e.target.files) {
      return;
    }
    if (!window.XLSX) {
      window.App.UI.showToast('Carregando motor de Excel...', 'info');
      try {
        await window.Utils.loadScript(
          'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
        );
      } catch {
        window.App.UI.showToast('Erro ao carregar o motor.', 'error');
        e.target.value = '';
        return;
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
          type: 'array'
        });
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
          header: 1
        });
        if (rows.length < 2) {
          return window.App.UI.showToast('Arquivo vazio ou inválido.', 'error');
        }
        window.App.UI.showToast('Importando lista... Aguarde.', 'info');
        let c = 0,
          ignored = 0,
          failures = 0;
        const eN = new Set(window.App.Data.users.map((u) => String(u.name || '').trim().toLowerCase())),
          eE = new Set(
            window.App.Data.users.map((u) => String(u.email || '').trim().toLowerCase()).filter((em) => em)
          );
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i];
          if (!cols || cols.length === 0) {
            ignored++;
            continue;
          }
          const n = cols[0] !== null && cols[0] !== undefined ? String(cols[0]).trim() : '',
            em = cols[1] !== null && cols[1] !== undefined ? String(cols[1]).trim().toLowerCase() : '';
          if (!n || !em) {
            ignored++;
            continue;
          }
          const lN = n.toLowerCase();
          if (eN.has(lN) || eE.has(em)) {
            ignored++;
            continue;
          }
          try {
            await requestUsersApi('/api/users/create', 'POST', {
              name: n,
              email: em,
              department: '',
              accessLevel: 'Usuário Padrão'
            });
            eN.add(lN);
            eE.add(em);
            c++;
          } catch (err) {
            failures++;
            window.Logger.warn(`Erro ao importar usuário ${n}:`, err?.message);
          }
        }
        const firstAccessGuidance =
          c > 0
            ? ' Oriente os usuários criados a usar "Primeiro acesso ou esqueceu a senha?" para definir a senha.'
            : '';

        const summary =
          `${c} registro(s) criado(s). ` +
          `${ignored} ignorado(s) ou inválido(s). ` +
          `${failures} falha(s).` +
          firstAccessGuidance;

        window.App.UI.showToast(
          summary,
          failures > 0 ? 'error' : c > 0 ? 'success' : 'warning'
        );
      } catch {
        window.App.UI.showToast('Falha ao ler Excel.', 'error');
      } finally {
        e.target.value = '';
      }
    };
    r.onerror = () => {
      window.Logger.error('Erro ao ler o arquivo de importação.', r.error);
      window.App.UI.showToast('Falha ao ler o arquivo.', 'error');
      e.target.value = '';
    };
    r.readAsArrayBuffer(f);
  },
  getEnhancedEmptyState: function () {
    const hasFilters =
      this.currentAccessFilter !== 'all' ||
      document.getElementById('users-search')?.value ||
      this.currentSort !== 'name';

    return `
      <div class="col-span-full p-12 flex flex-col items-center justify-center text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 animate-fade-in">
        <div class="w-24 h-24 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-12 h-12 text-slate-400">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="17" x2="22" y1="8" y2="13"/>
            <line x1="22" x2="17" y1="8" y2="13"/>
          </svg>
        </div>
        <h3 class="text-lg font-bold text-slate-900 dark:text-white mb-2">
          ${hasFilters ? 'Nenhum usuário encontrado' : 'Nenhum usuário cadastrado'}
        </h3>
        <p class="text-slate-500 dark:text-slate-400 max-w-md mb-6">
          ${
  hasFilters
    ? 'Tente ajustar os filtros ou termos de busca para encontrar o que procura.'
    : 'Comece cadastrando o primeiro usuário do sistema.'
}
        </p>
        ${
  !hasFilters
    ? `
          <button onclick="App.CRUDUsers.openModal()" class="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-lg shadow-brand-600/30 transition-all active:scale-95 flex items-center gap-2">
            <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14"/><path d="M12 5v14"/>
            </svg>
            Cadastrar Primeiro Usuário
          </button>
        `
    : `
          <button onclick="App.CRUDUsers.setAccessFilter('all'); document.getElementById('users-search').value = ''; App.CRUDUsers.applyFilters();" class="px-6 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl transition-all">
            Limpar Filtros
          </button>
        `
}
      </div>
    `;
  },
  exportExcel: async function () {
    if (!window.XLSX) {
      window.App.UI.showToast('Carregando motor de planilhas...', 'info');
      try {
        await window.Utils.loadScript(
          'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
        );
      } catch {
        return window.App.UI.showToast('Erro ao carregar o motor.', 'error');
      }
    }
    if (!window.App.Data.users || window.App.Data.users.length === 0) {
      return window.App.UI.showToast('Nenhum colaborador para exportar.', 'warning');
    }
    const data = window.App.Data.users.map((u) => ({
      'Nome Completo': u.name || '',
      'E-mail': u.email || '',
      'Nivel de Acesso': u.accessLevel || 'Usuário Padrão',
      Status: u.status || 'Ativo',
      Departamento: u.department || '-',
      'Criado em': u.createdAt ? new Date(u.createdAt).toLocaleString('pt-BR') : '-'
    }));
    const ws = window.XLSX.utils.json_to_sheet(data);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Colaboradores');
    window.XLSX.writeFile(wb, `colaboradores_coeng_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
};
