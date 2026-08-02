import {
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, auth, DB_BASE_PATH, COLLECTIONS, CONFIG } from '../app.js';

export const AppCRUDCollaborators = {
  collabLimit: 30,
  selectedCollabs: new Set(),
  currentPendingFilter: 'all',

  _hasPermission: function (permission) {
    return window.App?.Auth?.permissions?.[permission] === true;
  },
  _denyAccess: function () {
    window.App.UI.showToast('Acesso restrito a administradores.', 'error');
  },

  setPendingFilter: function (filter) {
    this.currentPendingFilter = filter;
    document.querySelectorAll('#collab-quick-filters .collab-filter-btn').forEach((btn) => {
      if (btn.dataset.filter === filter) {
        btn.classList.add('active', 'bg-brand-600', 'text-white', 'border-brand-600');
        btn.classList.remove('bg-white', 'dark:bg-slate-900', 'text-slate-600');
      } else {
        btn.classList.remove('active', 'bg-brand-600', 'text-white', 'border-brand-600');
        btn.classList.add('bg-white', 'dark:bg-slate-900', 'text-slate-600', 'dark:text-slate-300');
      }
    });
    this.render();
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
    if (!window.App.Data.collaboratorsLoaded) {
      list.innerHTML = Array(6).fill(window.Utils.getSkeletonHTML()).join('');
      return;
    }

    const collaborators = window.App.Data.collaborators;

    const totalCountEl = document.getElementById('collab-total-count');
    if (totalCountEl) {
      totalCountEl.textContent = `${collaborators.length} colaboradore${collaborators.length !== 1 ? 's' : ''} cadastrado${collaborators.length !== 1 ? 's' : ''}`;
    }

    const roleFilterEl = document.getElementById('collab-role-filter');
    if (roleFilterEl && roleFilterEl.options.length <= 1) {
      const roles = [...new Set(collaborators.map((c) => c.role).filter(Boolean))].sort();
      roles.forEach((role) => {
        const option = document.createElement('option');
        option.value = role;
        option.textContent = role;
        roleFilterEl.appendChild(option);
      });
    }

    const q = document.getElementById('collab-search')?.value.trim() || '';
    const roleFilter = document.getElementById('collab-role-filter')?.value || 'all';
    const statusFilter = document.getElementById('collab-status-filter')?.value || 'all';
    const sort = document.getElementById('collab-sort')?.value || 'name-asc';
    const groupByRole = document.getElementById('collab-group-toggle')?.checked ?? true;

    let filtered = collaborators;

    if (statusFilter !== 'all') {
      const isActive = statusFilter === 'active';
      filtered = filtered.filter(
        (c) => (c.status || 'active') === (isActive ? 'active' : 'inactive')
      );
    }

    if (roleFilter !== 'all') {
      filtered = filtered.filter((c) => c.role === roleFilter);
    }

    if (q) {
      const lowerQ = window.Utils.removeAccents(q).toLowerCase();
      filtered = filtered.filter(
        (u) =>
          window.Utils.removeAccents(String(u.name || ''))
            .toLowerCase()
            .includes(lowerQ) ||
          window.Utils.removeAccents(String(u.badge || ''))
            .toLowerCase()
            .includes(lowerQ) ||
          window.Utils.removeAccents(String(u.role || ''))
            .toLowerCase()
            .includes(lowerQ)
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

    const resultCountEl = document.getElementById('collab-result-count');
    if (resultCountEl) {
      resultCountEl.textContent = `Mostrando ${Math.min(filtered.length, this.collabLimit)} de ${filtered.length} colaboradore${filtered.length !== 1 ? 's' : ''}`;
    }

    if (!filtered.length) {
      list.innerHTML = `<div class="col-span-full text-center py-16 empty-state">
        <svg class="w-16 h-16 mx-auto text-slate-300 mb-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <h3 class="text-lg font-bold text-slate-700">Nenhum colaborador encontrado</h3>
        <p class="text-slate-500 mt-2">Tente ajustar os filtros de busca</p>
      </div>`;
      document.getElementById('collab-load-more')?.classList.add('hidden');
      document.getElementById('collab-pagination-info')?.classList.add('hidden');
      return;
    }

    if (groupByRole) {
      this.renderWithGrouping(filtered, list);
    } else {
      this.renderFlat(filtered, list);
    }
  },

  renderWithGrouping: function (filtered, list) {
    const groups = {};
    filtered.forEach((c) => {
      const role = c.role || 'Sem Cargo';
      if (!groups[role]) {
        groups[role] = [];
      }
      groups[role].push(c);
    });

    const sortedRoles = Object.keys(groups).sort();
    let html = '';
    let totalShown = 0;

    sortedRoles.forEach((role) => {
      const members = groups[role];
      const shown = Math.min(members.length, this.collabLimit - totalShown);
      if (shown === 0 || totalShown >= this.collabLimit) {
        return;
      }

      totalShown += shown;

      html += `<div class="col-span-full mt-6 mb-2">
        <div class="flex items-center gap-3 px-4 py-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-xl">
          <svg class="w-5 h-5 text-brand-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <h4 class="font-bold text-brand-700 dark:text-brand-400 text-sm">${window.Utils.escapeHTML(role)}</h4>
          <span class="ml-auto text-xs font-bold text-brand-600 dark:text-brand-500 bg-brand-100 dark:bg-brand-900/40 px-2 py-0.5 rounded-full">${members.length}</span>
        </div>
      </div>`;

      html += members
        .slice(0, this.collabLimit)
        .map((u, idx) => this.renderCard(u, idx))
        .join('');
    });

    list.innerHTML = html;

    const showLoadMore = filtered.length > this.collabLimit;
    document.getElementById('collab-load-more')?.classList.toggle('hidden', !showLoadMore);
    document.getElementById('collab-pagination-info')?.classList.toggle('hidden', !showLoadMore);

    const paginationInfoEl = document.getElementById('collab-pagination-info');
    if (paginationInfoEl) {
      if (showLoadMore) {
        paginationInfoEl.textContent = `Mostrando os primeiros ${totalShown} de ${filtered.length} colaboradores`;
      } else {
        paginationInfoEl.textContent = `Mostrando todos os ${filtered.length} colaboradores em ${sortedRoles.length} cargo${sortedRoles.length !== 1 ? 's' : ''}`;
      }
    }
  },

  renderFlat: function (filtered, list) {
    const showLoadMore = filtered.length > this.collabLimit;
    document.getElementById('collab-load-more')?.classList.toggle('hidden', !showLoadMore);
    document.getElementById('collab-pagination-info')?.classList.toggle('hidden', !showLoadMore);

    const paginated = filtered.slice(0, this.collabLimit);

    const paginationInfoEl = document.getElementById('collab-pagination-info');
    if (paginationInfoEl) {
      if (showLoadMore) {
        paginationInfoEl.textContent = `Mostrando os primeiros ${paginated.length} de ${filtered.length} colaboradores`;
      } else {
        paginationInfoEl.textContent = `Mostrando todos os ${filtered.length} colaboradores`;
      }
    }

    list.innerHTML = paginated.map((u, idx) => this.renderCard(u, idx)).join('');
  },

  renderCard: function (u, idx) {
    const statusColor = (u.status || 'active') === 'active' ? 'emerald' : 'slate';
    const statusText = (u.status || 'active') === 'active' ? 'Ativo' : 'Inativo';
    const statusBorder =
      (u.status || 'active') === 'active' ? 'border-l-emerald-500' : 'border-l-rose-500';
    const canManageCollaborators = this._hasPermission(
      'canManageCollaborators'
    );
    const imgHtml = u.imageUrl
      ? `<img src="${window.Utils.escapeHTML(u.imageUrl)}" onclick="App.UI.showImagePreview(this.src, '${window.Utils.escapeHTML(u.name)}')" class="w-14 h-14 rounded-full object-cover border-2 border-slate-200 dark:border-slate-700 cursor-zoom-in shadow-sm" loading="lazy" decoding="async">`
      : '<div class="w-14 h-14 rounded-full border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>';

    const pendingTools = this.getPendingTools(u.name);
    const pendingBadge =
      pendingTools.length > 0
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400 text-[10px] font-bold rounded border border-rose-200 dark:border-rose-800" title="${pendingTools.length} Ferramenta(s) em posse"><svg class="w-3 h-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> ${pendingTools.length} PENDENTE(S)</span>`
        : '';

    let whatsappBtn = '';
    if (u.phone && pendingTools.length > 0) {
      const rawPhone = u.phone.replace(/\D/g, '');
      if (rawPhone.length > 0) {
        const finalPhone = rawPhone.length <= 11 ? `55${rawPhone}` : rawPhone;
        const msg = encodeURIComponent(
          `Olá ${u.name.split(' ')[0]}, consta no sistema do Almoxarifado que você possui ${pendingTools.length} ferramenta(s) pendente(s) de devolução. Por favor, regularize assim que possível!`
        );
        whatsappBtn = `<a href="https://wa.me/${finalPhone}?text=${msg}" target="_blank" class="flex-1 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded-xl border border-emerald-200 dark:border-emerald-800 transition-colors flex items-center justify-center shadow-sm" title="Cobrar via WhatsApp"><svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>`;
      }
    }

    return `<div class="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 border-l-4 ${statusBorder} p-5 flex flex-col gap-4 hover:shadow-lg transition-all relative overflow-hidden group animate-fade-in opacity-0" style="animation-delay: ${Math.min(idx * 20, 400)}ms; animation-fill-mode: forwards;">
      <div class="flex items-start gap-4">
         ${imgHtml}
         <div class="flex-1 min-w-0 pt-1">
            <h3 class="font-extrabold text-slate-900 dark:text-white text-base leading-tight truncate" title="${window.Utils.escapeHTML(u.name)}">${window.Utils.escapeHTML(u.name || 'Sem nome')}</h3>
            <div class="flex items-center gap-2 mt-1.5 flex-wrap"><span class="text-[11px] font-bold text-slate-500 truncate max-w-[120px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded" title="${window.Utils.escapeHTML(u.role)}">${window.Utils.escapeHTML(u.role || 'Não definida')}</span><span class="px-2 py-0.5 bg-${statusColor}-100 dark:bg-${statusColor}-900/30 text-${statusColor}-700 dark:text-${statusColor}-400 text-[10px] font-bold rounded uppercase tracking-wider">${statusText}</span></div>
            <div class="mt-2">${pendingBadge}</div>
         </div>
      </div>
      <div class="border-t border-slate-100 dark:border-slate-800"></div>
      <div class="flex flex-col gap-2">
         <div class="flex justify-between items-center"><span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ponto/Cracha</span><span class="font-mono text-indigo-600 dark:text-indigo-400 font-bold text-sm bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-md border border-indigo-100 dark:border-indigo-800/50">${window.Utils.escapeHTML(u.badge || '-')}</span></div>
         ${u.phone ? `<div class="flex justify-between items-center"><span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Contato</span><span class="text-[11px] font-bold text-slate-600 dark:text-slate-300">${window.Utils.escapeHTML(u.phone)}</span></div>` : ''}
      </div>
      <div class="flex gap-1.5 mt-2">
          ${canManageCollaborators ? `<button onclick="App.CRUDCollaborators.openModal('${u.firebaseId}')" class="flex-1 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center shadow-sm" title="Editar Colaborador"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg></button>` : ''}
          ${canManageCollaborators ? `<button onclick="App.CRUDCollaborators.toggleStatus('${u.firebaseId}')" class="flex-1 py-2 bg-slate-50 dark:bg-slate-800 ${u.status === 'inactive' ? 'hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400' : 'hover:bg-rose-50 dark:hover:bg-rose-900/30 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400'} rounded-xl border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center shadow-sm" title="${u.status === 'inactive' ? 'Ativar' : 'Desativar / Bloquear'}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M18.36 6.64A9 9 0 0 1 20.77 15"/><path d="M6.16 6.16a9 9 0 1 0 12.68 12.68"/><path d="M12 2v10"/></svg></button>` : ''}
         <button onclick="App.CRUDCollaborators.showHistory('${window.Utils.escapeHTML(u.name)}')" class="flex-1 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center shadow-sm" title="Ver Histórico"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg></button>
         ${whatsappBtn}
          ${canManageCollaborators ? `<button onclick="App.CRUDCollaborators.deleteCollaborator('${u.firebaseId}')" class="flex-1 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-900/30 text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-rose-200 dark:hover:border-rose-800 transition-colors flex items-center justify-center shadow-sm" title="Excluir Colaborador"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M3 6h18"/><path d="M19 6v14c0-1 1-2 2-2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>` : ''}
      </div>
    </div>`;
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
      window.Utils.loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js')
        .then(() => this.exportList())
        .catch(() => window.App.UI.showToast('Erro ao carregar motor.', 'error'));
      return;
    }

    const data = window.App.Data.collaborators.map((c) => ({
      Nome: c.name,
      Crachá: c.badge,
      Cargo: c.role
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
      if (!confirm(`Excluir permanentemente ${collabs.length} colaborador(es)?`)) {
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
        window.Utils.loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js')
          .then(() => this.bulkAction('export'))
          .catch(() => window.App.UI.showToast('Erro ao carregar motor.', 'error'));
        return;
      }
      const data = collabs.map((c) => ({
        Nome: c.name,
        Crachá: c.badge,
        Cargo: c.role,
        Telefone: c.phone || '',
        Status: c.status === 'inactive' ? 'Inativo' : 'Ativo'
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
      list.innerHTML = '<div class="text-center py-8 text-slate-500 font-medium">Nenhum histórico de movimentação para este colaborador.</div>';
    } else {
      list.innerHTML = logs
        .map((log) => {
          const logType = String(log.type || '').toLowerCase();
          const accentClass =
            logType === 'in'
              ? 'bg-emerald-500'
              : logType === 'out'
                ? 'bg-amber-500'
                : 'bg-slate-400';
          const safeTool = window.Utils.escapeHTML(log.toolName || 'Desconhecida');
          const safeCode = window.Utils.escapeHTML(log.toolCode || '-');
          const date = window.Utils.formatDate(log.date);
          const typeText = logType === 'in' ? 'Devolveu' : 'Retirou';
          return `
          <div class="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700 flex items-start gap-4 shadow-sm relative overflow-hidden">
            <div class="absolute left-0 top-0 w-1 h-full ${accentClass}"></div>
            <div class="w-10 h-10 rounded-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4 ${logType === 'in' ? 'text-emerald-500' : 'text-amber-500'}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-bold text-slate-900 dark:text-white"><span class="${logType === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}">${typeText}</span> a ferramenta</p>
              <p class="text-base font-extrabold text-slate-800 dark:text-slate-200 truncate mt-0.5">${safeTool}</p>
              <div class="flex items-center gap-2 mt-2">
                 <span class="text-[10px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded">${safeCode}</span>
                 <span class="text-[10px] font-bold text-slate-400">${date}</span>
              </div>
            </div>
          </div>
        `;
        })
        .join('');
    }

    modal.showModal();
  },

  closeHistoryModal: function () {
    const m = document.getElementById('collab-history-modal');
    if (m) {
      m.close();
    }
  },

  openModal: function (id = null) {
    if (!this._hasPermission('canManageCollaborators')) {
      this._denyAccess();
      return;
    }

    const m = document.getElementById('crud-collab-modal');
    const pre = document.getElementById('crud-collab-image-preview');
    const icon = document.getElementById('collab-image-icon');
    if (m) {
      m.showModal();
    }
    document.getElementById('crud-collab-image').value = '';
    if (pre) {
      pre.classList.add('hidden');
      pre.src = '';
    }
    if (icon) {
      icon.classList.remove('hidden');
    }
    if (id) {
      const u = window.App.Data.collaborators.find((x) => x.firebaseId === id);
      document.getElementById('collab-modal-title').innerHTML = 'Editar Colaborador';
      document.getElementById('crud-collab-id').value = u.firebaseId;
      document.getElementById('crud-collab-badge').value = u.badge || '';
      document.getElementById('crud-collab-name').value = u.name;
      document.getElementById('crud-collab-role').value = u.role || '';
      document.getElementById('crud-collab-phone').value = u.phone || '';
      if (u.imageUrl && pre && icon) {
        pre.src = u.imageUrl;
        pre.classList.remove('hidden');
        icon.classList.add('hidden');
      }
    } else {
      document.getElementById('collab-modal-title').innerHTML = 'Novo Colaborador';
      document.getElementById('crud-collab-id').value = '';
      document.getElementById('crud-collab-badge').value = '';
      document.getElementById('crud-collab-name').value = '';
      document.getElementById('crud-collab-role').value = '';
      document.getElementById('crud-collab-phone').value = '';
    }
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

    if (!n || !b) {
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
      return window.App.UI.showToast('Cracha/Ponto já cadastrado.', 'warning');
    }
    const btn = document.getElementById('btn-save-collab');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 mr-2 animate-spin inline"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Salvando...';
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
            imageUrl: imgUrl
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
            imageUrl: imgUrl
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
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  },
  deleteCollaborator: async function (id) {
    if (!this._hasPermission('canManageCollaborators')) {
      this._denyAccess();
      return;
    }

    if (confirm('Excluir este colaborador?')) {
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
          'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
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
                role: rl
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
  }
};
