import { notifications } from '../core/NotificationManager.js';
import { metrics } from '../core/MetricsManager.js';

export const AppUI = {
  activeTab: 'dashboard',
  domCache: {},

  setMobileSidebarState: function (isOpen) {
    const sidebar = document.getElementById('main-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) {
      return;
    }

    sidebar.classList.toggle('-translate-x-full', !isOpen);
    sidebar.classList.toggle('translate-x-0', isOpen);
    if (overlay) {
      overlay.classList.toggle('hidden', !isOpen);
    }

    // Guardar estado em sessionStorage para persistência
    sessionStorage.setItem('sidebar-state', isOpen ? 'open' : 'closed');

    // Fechar menu do usuário ao abrir o sidebar
    if (isOpen) {
      this.closeUserMenu();
    }
  },

  closeUserMenu: function () {
    const userMenu = document.getElementById('user-dropdown-menu');
    if (!userMenu) {
      return;
    }
    userMenu.classList.add('opacity-0', 'invisible');
  },

  syncResponsiveLayout: function () {
    const sidebar = document.getElementById('main-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) {
      return;
    }

    // Se for Desktop (>= 1024px)
    if (window.innerWidth >= 1024) {
      sidebar.classList.remove('-translate-x-full');
      sidebar.classList.add('translate-x-0');
      if (overlay) {
        overlay.classList.add('hidden');
      }
      return;
    }

    // Mobile/Tablet (< 1024px) - restaurar estado anterior ou fechar
    const savedState = sessionStorage.getItem('sidebar-state');
    const shouldBeOpen = savedState === 'open';
    this.setMobileSidebarState(shouldBeOpen);
  },
  toggleSidebar: function () {
    const sidebar = document.getElementById('main-sidebar');
    if (!sidebar) {
      return;
    }

    // Fechar o menu do usuário sempre que o sidebar for alterado
    this.closeUserMenu();

    // Mobile/Tablet behavior (< 1024px) - toggle visibilidade
    if (window.innerWidth < 1024) {
      const isOpen = !sidebar.classList.contains('-translate-x-full');
      this.setMobileSidebarState(!isOpen);
    } else {
      // Desktop behavior - toggle entre expanded e collapsed
      if (sidebar.classList.contains('lg:w-72')) {
        sidebar.classList.remove('lg:w-72');
        sidebar.classList.add('lg:w-20');
      } else {
        sidebar.classList.remove('lg:w-20');
        sidebar.classList.add('lg:w-72');
      }
    }
  },
  toggleDarkMode: function () {
    const html = document.documentElement;
    html.classList.toggle('dark');
    html.classList.toggle('light', !html.classList.contains('dark'));
    const isDark = html.classList.contains('dark');

    // Salvar preferência localmente
    localStorage.setItem('theme', isDark ? 'dark' : 'light');

    const icon = document.getElementById('dark-mode-icon');
    if (icon) {
      icon.innerHTML = isDark
        ? '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'
        : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>';
    }
    const text = document.getElementById('dark-mode-text');
    if (text) {
      text.textContent = isDark ? 'Modo Claro' : 'Modo Noturno';
    }

    // Atualiza dinamicamente as cores globais e tooltips do Chart.js
    if (window.Chart) {
      window.Chart.defaults.color = isDark ? '#cbd5e1' : '#64748b'; // slate-300 / slate-500
      if (window.Chart.defaults.plugins && window.Chart.defaults.plugins.tooltip) {
        window.Chart.defaults.plugins.tooltip.backgroundColor = isDark ? '#1e293b' : '#ffffff';
        window.Chart.defaults.plugins.tooltip.titleColor = isDark ? '#f8fafc' : '#0f172a';
        window.Chart.defaults.plugins.tooltip.bodyColor = isDark ? '#cbd5e1' : '#475569';
        window.Chart.defaults.plugins.tooltip.borderColor = isDark ? '#334155' : '#e2e8f0';
        window.Chart.defaults.plugins.tooltip.borderWidth = 1;
      }
      for (const id in window.Chart.instances) {
        window.Chart.instances[id].update();
      }
    }
  },
  copyToClipboard: function (elementId) {
    const el = document.getElementById(elementId);
    if (!el) {
      return;
    }

    const text = el.textContent;
    if (!text || text === 'Sem e-mail' || text === 'Desconhecido') {
      return;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => {
        window.App.UI.showToast('Copiado!', 'success');
      })
      .catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        window.App.UI.showToast('Copiado!', 'success');
      });
  },
  toggleUserMenu: function (e) {
    if (e) {
      e.stopPropagation();
    }
    const menu = document.getElementById('user-dropdown-menu');
    if (menu) {
      menu.classList.toggle('opacity-0');
      menu.classList.toggle('invisible');

      // Fechar o sidebar (no mobile/tablet) se o menu de usuário for aberto
      if (!menu.classList.contains('opacity-0') && window.innerWidth < 1024) {
        this.setMobileSidebarState(false);
      }
    }
  },
  updateNetworkStatus: function (isOnline) {
    const dot = document.getElementById('network-status-dot');
    const text = document.getElementById('network-status-text');
    if (!dot || !text) {
      return;
    }
    if (isOnline) {
      dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
      text.textContent = 'Sistema Online';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-rose-500 animate-pulse';
      text.textContent = 'Sistema Offline';
    }
  },
  init: function () {
    // Inicializa o tema baseado no localStorage ou preferência do sistema
    const savedTheme = localStorage.getItem('theme');
    const prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    const isDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      const icon = document.getElementById('dark-mode-icon');
      if (icon) {
        icon.innerHTML = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
      }
      const text = document.getElementById('dark-mode-text');
      if (text) {
        text.textContent = 'Modo Claro';
      }
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }

    // Aplica a cor correta do Chart.js logo na inicialização
    if (window.Chart) {
      window.Chart.defaults.color = isDark ? '#cbd5e1' : '#64748b';
      if (window.Chart.defaults.plugins && window.Chart.defaults.plugins.tooltip) {
        window.Chart.defaults.plugins.tooltip.backgroundColor = isDark ? '#1e293b' : '#ffffff';
        window.Chart.defaults.plugins.tooltip.titleColor = isDark ? '#f8fafc' : '#0f172a';
        window.Chart.defaults.plugins.tooltip.bodyColor = isDark ? '#cbd5e1' : '#475569';
        window.Chart.defaults.plugins.tooltip.borderColor = isDark ? '#334155' : '#e2e8f0';
        window.Chart.defaults.plugins.tooltip.borderWidth = 1;
      }
    }

    // Inicializa e escuta o status real da rede da máquina/celular
    this.updateNetworkStatus(navigator.onLine);
    window.addEventListener('online', () => {
      this.updateNetworkStatus(true);
    });
    window.addEventListener('offline', () => {
      this.updateNetworkStatus(false);
    });

    // Fechar menu do usuário ao clicar fora da área dele
    document.addEventListener('click', (e) => {
      const menuContainer = document.getElementById('user-menu-container');
      const menu = document.getElementById('user-dropdown-menu');
      if (
        menu &&
        !menu.classList.contains('opacity-0') &&
        menuContainer &&
        !menuContainer.contains(e.target)
      ) {
        menu.classList.add('opacity-0', 'invisible');
      }
    });

    // Fechar o menu do usuário ao clicar em qualquer opção do dropdown
    const userDropdownMenu = document.getElementById('user-dropdown-menu');
    if (userDropdownMenu) {
      userDropdownMenu.addEventListener('click', (e) => {
        const target = e.target;
        if (target.closest('button, a, label') || target.closest('[data-close-user-menu]')) {
          this.closeUserMenu();
        }
      });
    }

    // Fechar sidebar no mobile/tablet ao clicar na máscara escura (overlay)
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    if (sidebarOverlay) {
      sidebarOverlay.addEventListener('click', () => {
        if (window.innerWidth < 1024) {
          this.setMobileSidebarState(false);
        }
      });
    }

    this.domCache = {
      dashList: document.getElementById('dash-list'),
      historyList: document.getElementById('history-list'),
      crudList: document.getElementById('crud-list'),
      usersList: document.getElementById('user-management-body'),
      collabList: document.getElementById('collab-list'),
    };
    const cdf = document.getElementById('current-date-full');
    const cdfShort = document.getElementById('current-date-full-short');
    const now = new Date();
    const fullDate = now.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
    const shortDate = now.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    if (cdf) {
      cdf.textContent = fullDate;
    }
    if (cdfShort) {
      cdfShort.textContent = shortDate;
    }

    // Setup search and filter listeners (only once)
    if (!this._listenersSetup) {
      this._listenersSetup = true;
      ['dash-search', 'tools-search', 'users-search', 'collab-search', 'history-search'].forEach(
        (id) =>
          document.getElementById(id)?.addEventListener(
            'input',
            window.Utils.debounce(() => this.renderAll(), 300)
          )
      );
      ['dash-filter', 'dash-sort'].forEach((id) =>
        document.getElementById(id)?.addEventListener('change', () => this.renderDashboard())
      );
      // Collaborators filters
      ['collab-role-filter', 'collab-sort', 'collab-status-filter'].forEach((id) =>
        document.getElementById(id)?.addEventListener('change', () => {
          window.App.CRUDCollaborators.collabLimit = 30;
          window.App.CRUDCollaborators.render();
        })
      );
      // Group toggle
      document.getElementById('collab-group-toggle')?.addEventListener('change', () => {
        window.App.CRUDCollaborators.collabLimit = 30;
        window.App.CRUDCollaborators.render();
      });

      // Navegação do Sidebar
      document.querySelectorAll('.nav-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const tab = e.currentTarget.getAttribute('data-tab');
          if (tab) {
            this.switchTab(tab, e.currentTarget.id);
          }
        });
      });

      // ============================================
      // LISTENERS RESPONSIVOS (Novos!)
      // ============================================
      // Listener para mudança de breakpoint
      if (window.App?.Responsive) {
        window.addEventListener('breakpointChange', (e) => {
          const { new: newBreakpoint } = e.detail;

          // Re-render ao mudar de breakpoint
          if (this.activeTab === 'dashboard') {
            this.renderDashboard();
          }

          // Aplicar classes CSS de breakpoint
          document.documentElement.setAttribute('data-breakpoint', newBreakpoint);
        });

        // Listener para resize responsivo
        window.addEventListener('responsiveResize', () => {
          // Atualizar layouts que dependem de tamanho da tela
          if (this.activeTab === 'management') {
            setTimeout(() => window.App.CRUDTools.render(), 100);
          }
        });
      }

      // Listener para mudança de orientação no mobile
      window.addEventListener('orientationchange', () => {
        setTimeout(() => {
          this.syncResponsiveLayout();
          if (window.innerWidth < 1024) {
            this.setMobileSidebarState(false);
          }
        }, 200);
      });
    }

    // Inventory sort
    document.getElementById('inventory-sort')?.addEventListener('change', () => {
      window.App.CRUDTools.render();
    });

    document
      .getElementById('history-time-filter')
      ?.addEventListener('change', () => window.App.Data.processAndRenderHistory());

    document.getElementById('inventory-category-filter')?.addEventListener('change', () => {
      window.App.CRUDTools.render();
    });

    // Populate category filter dropdown
    const categoryFilterEl = document.getElementById('inventory-category-filter');
    if (categoryFilterEl && categoryFilterEl.options.length <= 1) {
      const categories = [
        ...new Set(window.App.Data.tools.map((t) => t.category).filter(Boolean)),
      ].sort();
      categories.forEach((cat) => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categoryFilterEl.appendChild(option);
      });
    }

    // Back to top button listener
    if (!this._scrollListenerSetup) {
      this._scrollListenerSetup = true;
      const scrollCont = document.getElementById('main-content-scroll');
      const btnTop = document.getElementById('back-to-top');
      if (scrollCont && btnTop) {
        scrollCont.addEventListener('scroll', () => {
          if (scrollCont.scrollTop > 300) {
            btnTop.classList.remove('opacity-0', 'pointer-events-none');
            btnTop.classList.add('opacity-100', 'pointer-events-auto');
          } else {
            btnTop.classList.remove('opacity-100', 'pointer-events-auto');
            btnTop.classList.add('opacity-0', 'pointer-events-none');
          }
        });
        btnTop.addEventListener('click', () => {
          scrollCont.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
    }

    // Adiciona o fechamento por clique no backdrop para todos os modais da tela
    document.querySelectorAll('dialog').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        // Verifica se o clique foi fora da área de conteúdo (no backdrop)
        const rect = dialog.getBoundingClientRect();
        const isInDialog =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (!isInDialog) {
          dialog.close();
        }
      });

      // Garante que a lógica de limpeza ou auditoria ocorra de forma idêntica
      // quer o usuário feche no botão, no clique de fundo ou usando a tecla ESC.
      dialog.addEventListener('close', () => {
        // Útil para parar câmeras, limpar formulários nativamente, ou logar métricas:
        // console.log(`Modal fechado: ${dialog.id}`);
      });
    });
  },
  switchTab: function (tab, sourceNavId = null) {
    const adminTabPermissions = {
      users: 'canAccessUsers',
      history: 'canAccessHistory',
    };
    const requiredPermission = adminTabPermissions[tab];
    if (requiredPermission && window.App?.Auth?.permissions?.[requiredPermission] !== true) {
      if (tab !== 'dashboard') {
        this.switchTab('dashboard');
      }
      this.showToast('Acesso restrito a administradores.', 'error');
      return;
    }

    this.activeTab = tab;
    metrics.trackNavigation(tab);

    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.remove('bg-brand-600', 'text-white', 'shadow-md', 'shadow-brand-600/20');
      b.classList.add('text-slate-400', 'hover:bg-slate-800', 'hover:text-white');
    });
    const a = document.getElementById(sourceNavId || `nav-${tab}`);
    if (a) {
      a.classList.remove('text-slate-400', 'hover:bg-slate-800', 'hover:text-white');
      a.classList.add('bg-brand-600', 'text-white', 'shadow-md', 'shadow-brand-600/20');
    }
    const titleMap = {
      dashboard: 'Visão Geral',
      scanner: 'Leitor / Scanner',
      management: 'Ferramentas',
      users: 'Controle de Acesso',
      collaborators: 'Colaboradores',
      history: 'Auditoria de Sistema',
    };
    const tt = document.getElementById('topbar-title');
    if (tt) {
      tt.textContent = titleMap[tab] || 'Gestão de Ferramentas';
    }
    ['dashboard', 'scanner', 'management', 'users', 'collaborators', 'history'].forEach((t) =>
      document.getElementById(`tab-${t}`)?.classList.toggle('hidden', t !== tab)
    );
    if (window.innerWidth < 1024) {
      this.setMobileSidebarState(false);
    }
    if (tab !== 'scanner') {
      // Ao sair da aba o Scanner volta ao modo USB: para a câmera e esconde o container,
      // evitando reabrir a aba com o overlay preto de uma câmera já parada.
      if (window.App.Scanner.currentMode === 'cam') {
        window.App.Scanner.setMode('usb');
      } else {
        window.App.Scanner.stopCamera();
      }
    } else {
      window.App.Scanner.focus();
    }
    this.renderAll();

    const mainContentScroll = document.getElementById('main-content-scroll');
    if (mainContentScroll) {
      mainContentScroll.scrollTop = 0;
      mainContentScroll.scrollTo({ top: 0, behavior: 'auto' });
    }
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  },
  renderAll: function () {
    if (this.activeTab === 'dashboard') {
      this.renderDashboard();
    } else if (this.activeTab === 'management') {
      window.App.CRUDTools.render();
    } else if (this.activeTab === 'users') {
      window.App.CRUDUsers.render();
    } else if (this.activeTab === 'collaborators') {
      window.App.CRUDCollaborators.render();
    } else if (this.activeTab === 'history') {
      this.renderHistory();
    }
  },
  renderDashboard: function () {
    const list = this.domCache.dashList;
    if (!list) {
      return;
    }
    if (!window.App.Data.toolsLoaded) {
      list.innerHTML = Array(6).fill(window.Utils.getSkeletonHTML()).join('');
      return;
    }
    const tools = window.App.Data.tools;
    const cA = tools.filter((t) => t.status === 'available').length;
    const cB = tools.filter((t) => t.status === 'borrowed').length;
    const cM = tools.filter((t) => t.status === 'maintenance').length;
    const total = tools.length;

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = val;
      }
    };

    // Update stat cards with percentages
    setText('stat-total', total);
    setText('stat-available', `${cA} (${total > 0 ? ((cA / total) * 100).toFixed(0) : 0}%)`);
    setText('stat-borrowed', `${cB} (${total > 0 ? ((cB / total) * 100).toFixed(0) : 0}%)`);
    setText('stat-maintenance', `${cM} (${total > 0 ? ((cM / total) * 100).toFixed(0) : 0}%)`);

    // Update chart
    if (window.Chart) {
      // Register datalabels plugin if available
      if (window.ChartDataLabels) {
        window.Chart.register(window.ChartDataLabels);
      }

      const canvas = document.getElementById('statusChart');
      if (!canvas) {
        return;
      } // Canvas not yet rendered

      const sChart = window.Chart.getChart(canvas);
      if (sChart) {
        sChart.data.datasets[0].data = [cA, cB, cM];
        sChart.update();
      } else {
        new window.Chart(canvas, {
          type: 'doughnut',
          data: {
            labels: ['Disponíveis', 'Emprestadas', 'Manutenção'],
            datasets: [
              {
                data: [cA, cB, cM],
                backgroundColor: ['#10b981', '#f59e0b', '#f43f5e'],
                borderWidth: 0,
                hoverOffset: 6,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function (context) {
                    const value = context.parsed;
                    const total = tools.length;
                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                    return `${context.label}: ${value} (${percentage}%)`;
                  },
                },
              },
              datalabels: {
                color: '#ffffff',
                font: {
                  weight: 'bold',
                  size: 14,
                },
                formatter: (value) => (value > 0 ? value : ''),
                anchor: 'center',
                align: 'center',
              },
            },
            animation: { animateRotate: true, animateScale: true },
          },
        });
      }

      // Gráfico de Categoria
      const canvasCat = document.getElementById('categoryChart');
      if (canvasCat) {
        const cEletrica = tools.filter((t) => t.category === 'Elétrica').length;
        const cManual = tools.filter((t) => t.category === 'Manual').length;
        const cMedicao = tools.filter((t) => t.category === 'Medição').length;
        const cOutros = tools.length - (cEletrica + cManual + cMedicao);

        const catData =
          cOutros > 0 ? [cEletrica, cManual, cMedicao, cOutros] : [cEletrica, cManual, cMedicao];
        const catLabels =
          cOutros > 0
            ? ['Elétrica', 'Manual', 'Medição', 'Outros']
            : ['Elétrica', 'Manual', 'Medição'];
        const catColors =
          cOutros > 0
            ? ['#3b82f6', '#10b981', '#f59e0b', '#64748b']
            : ['#3b82f6', '#10b981', '#f59e0b'];

        const cChart = window.Chart.getChart(canvasCat);
        if (cChart) {
          cChart.data.labels = catLabels;
          cChart.data.datasets[0].data = catData;
          cChart.data.datasets[0].backgroundColor = catColors;
          cChart.update();
        } else {
          new window.Chart(canvasCat, {
            type: 'doughnut',
            data: {
              labels: catLabels,
              datasets: [
                {
                  data: catData,
                  backgroundColor: catColors,
                  borderWidth: 0,
                  hoverOffset: 6,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              cutout: '65%',
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      const value = context.parsed;
                      const percentage =
                        tools.length > 0 ? ((value / tools.length) * 100).toFixed(1) : 0;
                      return `${context.label}: ${value} (${percentage}%)`;
                    },
                  },
                },
                datalabels: {
                  color: '#ffffff',
                  font: { weight: 'bold', size: 14 },
                  formatter: (value) => (value > 0 ? value : ''),
                  anchor: 'center',
                  align: 'center',
                },
              },
              animation: { animateRotate: true, animateScale: true },
            },
          });
        }
      }
    }

    // Update chart legend and quick filters...
    setText('filter-count-available', cA);
    setText('filter-count-borrowed', cB);
    setText('filter-count-maintenance', cM);
    this.renderDashboardTimeline();

    const cLate = tools.filter((t) => window.App.CRUDTools.isLate(t)).length;
    const cMaintDue = tools.filter((t) => window.App.CRUDTools.isMaintenanceDue(t)).length;
    setText('filter-count-late-dash', cLate);
    setText('filter-count-maint-due-dash', cMaintDue);

    const q = document.getElementById('dash-search')?.value.trim() || '';
    const f = document.getElementById('dash-filter')?.value || 'all';
    const sort = document.getElementById('dash-sort')?.value || 'name-asc';

    let filtered = tools;
    if (f !== 'all') {
      if (f === 'late') {
        filtered = filtered.filter((t) => window.App.CRUDTools.isLate(t));
      } else if (f === 'maintenance-due') {
        filtered = filtered.filter((t) => window.App.CRUDTools.isMaintenanceDue(t));
      } else {
        filtered = filtered.filter((t) => t.status === f);
      }
    }

    if (q) {
      const lowerQ = window.Utils.removeAccents(q).toLowerCase();
      filtered = filtered.filter(
        (t) =>
          window.Utils.removeAccents(String(t.name || ''))
            .toLowerCase()
            .includes(lowerQ) ||
          window.Utils.removeAccents(String(t.code || ''))
            .toLowerCase()
            .includes(lowerQ) ||
          window.Utils.removeAccents(String(t.currentUser || ''))
            .toLowerCase()
            .includes(lowerQ) ||
          window.Utils.removeAccents(String(t.category || ''))
            .toLowerCase()
            .includes(lowerQ)
      );
    }

    filtered.sort((a, b) => {
      switch (sort) {
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '', 'pt-BR');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '', 'pt-BR');
        case 'recent':
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        case 'category':
          return (a.category || '').localeCompare(b.category || '', 'pt-BR');
        default:
          return 0;
      }
    });

    const resultCountEl = document.getElementById('result-count');
    if (resultCountEl) {
      resultCountEl.textContent = `${filtered.length} ferramenta${filtered.length !== 1 ? 's' : ''} encontrada${filtered.length !== 1 ? 's' : ''}`;
    }

    if (!filtered.length) {
      list.innerHTML = window.Utils.getEmptyStateHTML(
        'Nenhum ativo encontrado para os filtros atuais.'
      );
      document.getElementById('dash-load-more')?.classList.add('hidden');
      return;
    }

    const showLoadMore = filtered.length > window.App.Data.dashLimit;
    document.getElementById('dash-load-more')?.classList.toggle('hidden', !showLoadMore);
    filtered = filtered.slice(0, window.App.Data.dashLimit);

    list.innerHTML = filtered
      .map((t) => {
        const safeName = window.Utils.escapeHTML(t.name);
        const fullName = window.Utils.escapeHTML(t.name);
        const uHtml = t.currentUser
          ? `<span class="font-extrabold text-slate-800 dark:text-slate-200 truncate">${window.Utils.escapeHTML(t.currentUser)}</span>`
          : '<span class="text-slate-300 font-medium italic">Nenhum responsável</span>';
        const responsibleRow = t.currentUser
          ? `<div class="flex justify-between items-center"><span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Responsável</span><div class="text-right text-sm max-w-[150px] truncate">${uHtml}</div></div>`
          : '';
        const imgHtml = t.imageUrl
          ? `<img src="${window.Utils.escapeHTML(t.imageUrl)}" data-name="${safeName}" onclick="App.UI.showImagePreview(this.src, this.getAttribute('data-name'))" class="w-12 h-12 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0 cursor-zoom-in" loading="lazy" decoding="async">`
          : '<div class="w-12 h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 text-slate-300 dark:text-slate-600"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>';
        const dotColor =
          t.status === 'borrowed'
            ? 'bg-amber-500'
            : t.status === 'maintenance'
              ? 'bg-rose-500'
              : 'bg-emerald-500';
        const statusBorderClass =
          t.status === 'borrowed'
            ? 'border-l-amber-500'
            : t.status === 'maintenance'
              ? 'border-l-rose-500'
              : 'border-l-emerald-500';

        const isLate = window.App.CRUDTools.isLate(t);
        const isMaintDue = window.App.CRUDTools.isMaintenanceDue(t);
        const isMaintWarn = window.App.CRUDTools.isMaintenanceWarning(t);
        let customBadges = '';
        if (isLate) {
          customBadges += `<span class="px-2 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold rounded animate-pulse border border-rose-200 shadow-sm whitespace-nowrap">⚠️ Atrasada (${window.App.CRUDTools.getDaysLate(t)}d)</span>`;
        }
        if (isMaintDue) {
          customBadges +=
            '<span class="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded animate-pulse border border-orange-200 shadow-sm whitespace-nowrap">⚠️ Rev. Vencida</span>';
        } else if (isMaintWarn) {
          customBadges +=
            '<span class="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-[10px] font-bold rounded border border-yellow-200 shadow-sm whitespace-nowrap">⏳ Rev. Próxima</span>';
        }

        const overrideBorder = isLate
          ? 'border-2 border-rose-500 shadow-rose-500/20'
          : isMaintDue
            ? 'border-2 border-orange-500 shadow-orange-500/20'
            : '';
        const finalBorderClass =
          overrideBorder ||
          `border border-slate-200 dark:border-slate-800 border-l-4 ${statusBorderClass}`;

        return `<div class="tool-card bg-white dark:bg-slate-900 rounded-2xl shadow-sm ${finalBorderClass} p-5 flex flex-col gap-4 relative overflow-hidden group" title="${fullName}"><div class="flex items-start gap-4"><div class="relative">${imgHtml}<span class="absolute -top-1 -right-1 w-3 h-3 rounded-full ${dotColor} border-2 border-white dark:border-slate-900 shadow-sm"></span></div><div class="flex-1 min-w-0"><h3 class="font-extrabold text-slate-900 dark:text-white text-sm sm:text-base leading-tight truncate" data-tooltip="${fullName}">${safeName}</h3><div class="flex items-center gap-1.5 mt-1.5 flex-wrap"><span class="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-[10px] font-bold rounded">${window.Utils.escapeHTML(t.category)}</span><p class="text-[10px] font-bold text-slate-500 truncate">Patrimônio: ${window.Utils.escapeHTML(t.code)}</p>${customBadges}</div></div></div><div class="border-t border-slate-100 dark:border-slate-800"></div><div class="flex flex-col gap-3"><div class="flex justify-between items-center"><span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estado</span><div class="text-right">${window.Utils.getBadgeHTML(t.status)}</div></div>${responsibleRow}</div></div>`;
      })
      .join(' ');
  },
  setQuickFilter: function (filter) {
    const filterSelect = document.getElementById('dash-filter');
    if (filterSelect) {
      filterSelect.value = filter;
    }
    document.querySelectorAll('.quick-filter-btn').forEach((btn) => {
      btn.classList.remove('active');
      if (btn.dataset.filter === filter) {
        btn.classList.add('active');
      }
    });
    this.renderDashboard();
  },
  renderHistory: function () {
    const list = this.domCache.historyList;
    if (!list) {
      return;
    }
    if (!window.App.Data.history) {
      return;
    }
    const q = window.Utils.removeAccents(
      document.getElementById('history-search')?.value || ''
    ).toLowerCase();
    const filtered = window.App.Data.history.filter(
      (log) =>
        window.Utils.removeAccents(String(log.toolName || ''))
          .toLowerCase()
          .includes(q) ||
        window.Utils.removeAccents(String(log.toolCode || ''))
          .toLowerCase()
          .includes(q) ||
        window.Utils.removeAccents(String(log.user || ''))
          .toLowerCase()
          .includes(q)
    );
    if (!filtered.length) {
      list.innerHTML = window.Utils.getEmptyStateHTML('Nenhum log para os critérios.');
      return;
    }
    list.innerHTML = filtered
      .map((log, idx) => {
        const logType = String(log.type || '').toLowerCase();
        const accentClass =
          logType === 'in' ? 'bg-emerald-500' : logType === 'out' ? 'bg-sky-500' : 'bg-slate-400';
        const iconWrapClass =
          logType === 'in'
            ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
            : logType === 'out'
              ? 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400'
              : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400';
        const safeToolName = window.Utils.escapeHTML(log.toolName || 'Ferramenta não informada');
        const safeToolCode = window.Utils.escapeHTML(log.toolCode || '-');
        const safeUser = window.Utils.escapeHTML(log.user || 'Sistema');
        const safeIp = window.Utils.escapeHTML(log.ip || 'Sem IP');
        const safeDevice = window.Utils.escapeHTML(
          String(log.device || '')
            .split(' / ')[0]
            .trim() || 'Dispositivo não informado'
        );
        return `<div class="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-5 flex flex-col gap-4 hover:shadow-md transition-shadow relative overflow-hidden group animate-fade-in opacity-0" style="animation-delay: ${Math.min(idx * 30, 500)}ms; animation-fill-mode: forwards;"><div class="absolute top-0 left-0 w-1 h-full ${accentClass} opacity-75"></div><div class="flex items-start gap-4 pl-2"><div class="w-12 h-12 rounded-xl border ${iconWrapClass} flex items-center justify-center shrink-0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg></div><div class="flex-1 min-w-0"><h4 class="font-extrabold text-slate-900 dark:text-white text-sm sm:text-base leading-tight truncate" title="${safeToolName}">${safeToolName}</h4><div class="flex items-center gap-1.5 mt-1.5"><span class="w-2 h-2 rounded-full ${accentClass}"></span><p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate">Patrimônio: ${safeToolCode}</p></div></div></div><div class="border-t border-slate-100 dark:border-slate-800 ml-2"></div><div class="flex flex-col gap-3 pl-2"><div class="flex justify-between items-center gap-3"><span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Movimentação</span><div class="text-right">${window.Utils.getBadgeHTML(log.type)}</div></div><div class="flex justify-between items-center gap-4"><span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Responsável</span><div class="text-right text-sm font-bold text-slate-700 dark:text-slate-300 truncate max-w-[170px]" title="${safeUser}">${safeUser}</div></div><div class="flex justify-between items-start gap-4"><span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data</span><div class="text-right text-[10px] font-bold text-slate-600 dark:text-slate-300">${window.Utils.formatDate(log.date)}</div></div><div class="flex justify-between items-start gap-4"><span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Origem</span><div class="text-right flex flex-col items-end"><span class="text-[9px] text-slate-500 dark:text-slate-400 truncate max-w-[170px]" title="IP: ${safeIp} | Disp: ${safeDevice}">${safeIp}</span><span class="text-[9px] text-slate-400 mt-0.5 truncate max-w-[170px]">${safeDevice}</span></div></div></div></div>`;
      })
      .join(' ');
  },
  showImagePreview: function (url, title) {
    const lb = document.getElementById('image-lightbox'),
      img = document.getElementById('lightbox-img'),
      cap = document.getElementById('lightbox-caption');
    if (img) {
      img.src = url;
    }
    if (cap) {
      cap.textContent = title || 'Visualização';
    }
    if (lb) {
      lb.showModal();
    }
  },
  closeImagePreview: function () {
    const lb = document.getElementById('image-lightbox');
    if (lb) {
      lb.close();
    }
  },
  showToast: function (msg, type = 'info') {
    // Proxy Pattern: Repassa a chamada para o novo NotificationManager Core
    try {
      if (type === 'success') {
        notifications.success(msg);
      } else if (type === 'error') {
        notifications.error(msg);
      } else if (type === 'warning') {
        notifications.warning(msg);
      } else {
        notifications.info(msg);
      }
    } catch {
      window.Logger.warn('NotificationManager falhou. Fallback log:', msg);
    }
  },
  renderDashboardTimeline: function () {
    const list = document.getElementById('dash-mini-timeline');
    if (!list) {
      return;
    }

    const logs = (window.App?.Data?.history || []).slice(0, 3);
    if (!logs.length) {
      list.innerHTML =
        '<div class="text-center py-4 text-slate-400 text-xs font-semibold">Sem movimentações recentes</div>';
      return;
    }

    const typeMeta = {
      in: {
        label: 'Devolução',
        status: 'Concluída',
        color: 'emerald',
        icon: '<path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />',
      },
      out: {
        label: 'Empréstimo',
        status: 'Registrado',
        color: 'amber',
        icon: '<path d="M17 14H3l4 4" /><path d="M7 10h14l-4-4" />',
      },
      maintenance: {
        label: 'Manutenção',
        status: 'Registrada',
        color: 'rose',
        icon: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />',
      },
    };

    list.innerHTML = logs
      .map((log, idx) => {
        const meta = typeMeta[log.type] || typeMeta.maintenance;
        const tool = window.Utils.escapeHTML(log.toolName || 'Ferramenta não informada');
        const date = window.Utils.formatDate(log.date);

        return `<div class="flex gap-3 items-start animate-fade-in" style="animation-delay: ${idx * 100}ms"><div class="w-8 h-8 rounded-full bg-${meta.color}-100 dark:bg-${meta.color}-900/30 text-${meta.color}-600 dark:text-${meta.color}-400 flex items-center justify-center shrink-0"><svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${meta.icon}</svg></div><div class="min-w-0"><p class="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">${meta.label} <span class="text-${meta.color}-600 dark:text-${meta.color}-400">${meta.status}</span></p><p class="text-[10px] text-slate-500 truncate">${tool} - ${date}</p></div></div>`;
      })
      .join('');
  },
  openMetricsModal: function () {
    const m = document.getElementById('metrics-modal');
    const content = document.getElementById('metrics-modal-content');
    if (!m || !content) {
      return;
    }

    // Puxamos o relatório ao vivo do MetricsManager
    const report = metrics.getReport();

    content.innerHTML = `
      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm text-center">
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Tempo Ativo (Sessão)</p>
          <p class="text-xl font-extrabold text-sky-600 dark:text-sky-400">${report.summary.uptimeFormatted}</p>
        </div>
        <div class="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm text-center">
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Taxa de Erros Ocultos</p>
          <p class="text-xl font-extrabold text-rose-600 dark:text-rose-400">${report.summary.errorRate}</p>
        </div>
      </div>

      <h4 class="font-bold text-slate-900 dark:text-white mb-3 text-sm">Atividades Rastreadas</h4>
      <div class="space-y-2 mb-2">
        <div class="flex justify-between items-center bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
          <span class="text-sm font-semibold text-slate-600 dark:text-slate-300">Empréstimos Via Scanner</span>
          <span class="font-mono font-bold text-slate-900 dark:text-white">${report.counters['tools.borrowed_total'] || 0}</span>
        </div>
        <div class="flex justify-between items-center bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
          <span class="text-sm font-semibold text-slate-600 dark:text-slate-300">Devoluções Via Scanner</span>
          <span class="font-mono font-bold text-slate-900 dark:text-white">${report.counters['tools.returned_total'] || 0}</span>
        </div>
        <div class="flex justify-between items-center bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
          <span class="text-sm font-semibold text-slate-600 dark:text-slate-300">Navegações ao Dashboard</span>
          <span class="font-mono font-bold text-slate-900 dark:text-white">${report.counters['navigation.screen.dashboard'] || 0}</span>
        </div>
      </div>
    `;

    m.showModal();
  },
  closeMetricsModal: function () {
    const m = document.getElementById('metrics-modal');
    if (m) {
      m.close();
    }
  },
};
