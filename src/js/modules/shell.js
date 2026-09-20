import { watchShellMode } from '../config/breakpoints.js';
import {
  APP_TITLE,
  getGroupedItems,
  getItemByTab,
  hashForRoute,
  splitForMobile
} from '../config/navigation.js';

/**
 * App shell (Gate 1-D): renderiza a navegação a partir de config/navigation.js e controla o
 * comportamento por breakpoint (config/breakpoints.js).
 *
 *   desktop  >= 1280   sidebar 256px, recolhe para 72px (estado persistido em localStorage)
 *   notebook 1024-1279 rail 72px; "expandir" abre 256px SOBRE o conteúdo (overlay)
 *   tablet   768-1023  drawer com overlay
 *   mobile   < 768     barra inferior (4 destinos + "Mais")
 *
 * O layout em si é CSS (src/css/shell.css, mesmos limites); este módulo mantém apenas o estado
 * interativo (data-state, aria-*, foco, Esc) e a lista de itens permitidos. Ele NÃO decide
 * autorização: recebe App.Auth.permissions e esconde o que não é permitido.
 */
const COLLAPSED_KEY = 'shell.sidebar.collapsed';
const SVG_NS = 'http://www.w3.org/2000/svg';
const FOCUSABLE = 'a[href], button:not([disabled])';

function makeIcon(iconId, className) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const use = document.createElementNS(SVG_NS, 'use');

  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  use.setAttribute('href', `#${iconId}`);
  svg.appendChild(use);

  return svg;
}

// "Retirar/Devolver" quebra depois da barra em telas estreitas, sem alterar o nome acessível.
function makeLabel(text, className) {
  const span = document.createElement('span');
  const parts = text.split('/');

  span.className = className;
  parts.forEach((part, index) => {
    if (index > 0) {
      span.appendChild(document.createTextNode('/'));
      span.appendChild(document.createElement('wbr'));
    }

    span.appendChild(document.createTextNode(part));
  });

  return span;
}

function makeLink(item, idPrefix, className, iconClass, labelClass) {
  const link = document.createElement('a');

  link.href = hashForRoute(item.route);
  link.id = `${idPrefix}-${item.id}`;
  link.className = className;
  link.dataset.navId = item.id;
  link.dataset.tab = item.tab;
  link.title = item.label;
  link.appendChild(makeIcon(item.icon, iconClass));
  link.appendChild(makeLabel(item.label, labelClass));

  return link;
}

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
  } catch {
    // Persistência é só conveniência: sem storage, o estado vale apenas para a sessão.
  }
}

export const AppShell = {
  mode: 'desktop',
  _permissions: null,
  _activeTab: null,
  _collapsed: false,
  _overlayOpen: false,
  _initialTitle: '',
  _watch: null,
  _initialized: false,

  $(id) {
    return document.getElementById(id);
  },

  init() {
    if (this._initialized) {
      return;
    }

    this._initialized = true;
    this._initialTitle = document.title;
    this._collapsed = readCollapsed();
    this._bindEvents();
    this._watch = watchShellMode((mode) => this._applyMode(mode));
    this._applyMode(this._watch.mode());
    this.applyPermissions(null);
  },

  // ---------------------------------------------------------------- renderização

  // Recebe App.Auth.permissions (ou null = ninguém autorizado) e redesenha toda a navegação.
  applyPermissions(permissions) {
    this._permissions = permissions;
    this._renderSidebar();
    this._renderBottomNav();
    this._renderMoreNav();
    this.setActive(this._activeTab);
  },

  _renderSidebar() {
    const nav = this.$('sidebar-nav');

    if (!nav) {
      return;
    }

    nav.replaceChildren();

    getGroupedItems(this._permissions).forEach(({ group, items }) => {
      const section = document.createElement('div');
      const label = document.createElement('p');
      const list = document.createElement('ul');

      section.className = 'shell-nav-group';
      section.setAttribute('role', 'group');
      section.setAttribute('aria-labelledby', `nav-group-${group.id}`);
      label.id = `nav-group-${group.id}`;
      label.className = 'shell-nav-group-label';
      label.textContent = group.label;
      list.className = 'shell-nav-list';

      items.forEach((item) => {
        const row = document.createElement('li');

        row.appendChild(
          makeLink(item, 'nav', 'shell-nav-item', 'shell-nav-icon', 'shell-nav-label')
        );
        list.appendChild(row);
      });

      section.append(label, list);
      nav.appendChild(section);
    });
  },

  _renderBottomNav() {
    const nav = this.$('bottom-nav');

    if (!nav) {
      return;
    }

    nav.replaceChildren();

    if (!this._permissions) {
      return;
    }

    const list = document.createElement('ul');
    const { primary } = splitForMobile(this._permissions);

    list.className = 'shell-bottom-list';
    primary.forEach((item) => {
      const row = document.createElement('li');

      row.appendChild(
        makeLink(item, 'bnav', 'shell-bnav-item', 'shell-bnav-icon', 'shell-bnav-label')
      );
      list.appendChild(row);
    });

    const more = document.createElement('li');
    const button = document.createElement('button');

    button.type = 'button';
    button.id = 'bnav-more';
    button.className = 'shell-bnav-item';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'more-sheet');
    button.appendChild(makeIcon('icon-more', 'shell-bnav-icon'));
    button.appendChild(makeLabel('Mais', 'shell-bnav-label'));
    more.appendChild(button);
    list.appendChild(more);
    nav.appendChild(list);
  },

  _renderMoreNav() {
    const host = this.$('more-nav');

    if (!host) {
      return;
    }

    host.replaceChildren();

    if (!this._permissions) {
      return;
    }

    // "Mais" lista SOMENTE os destinos autorizados que não couberam na barra inferior.
    const restIds = new Set(splitForMobile(this._permissions).more.map((item) => item.id));

    getGroupedItems(this._permissions).forEach(({ group, items }) => {
      const rest = items.filter((item) => restIds.has(item.id));

      if (rest.length === 0) {
        return;
      }

      const label = document.createElement('p');
      const list = document.createElement('ul');

      label.className = 'shell-more-label';
      label.textContent = group.label;
      list.className = 'shell-more-list';
      rest.forEach((item) => {
        const row = document.createElement('li');

        row.appendChild(
          makeLink(item, 'more', 'shell-more-item', 'shell-more-icon', 'shell-more-text')
        );
        list.appendChild(row);
      });
      host.append(label, list);
    });
  },

  // ---------------------------------------------------------------- rota ativa

  setActive(tab) {
    this._activeTab = tab;

    const item = tab ? getItemByTab(tab) : null;

    document.querySelectorAll('[data-nav-id]').forEach((link) => {
      if (item && link.dataset.navId === item.id) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });

    // Destino ativo escondido em "Mais": destaca o botão (não é uma página, sem aria-current).
    const more = this.$('bnav-more');

    if (more) {
      const inMore =
        Boolean(item) && Boolean(document.querySelector(`#more-nav [data-nav-id="${item.id}"]`));

      more.dataset.active = inMore ? 'true' : 'false';
    }

    const title = this.$('topbar-title');

    if (title) {
      title.textContent = item ? item.title : APP_TITLE;
    }

    document.title = item ? `${item.title} · ${APP_TITLE}` : this._initialTitle;
  },

  resetTitle() {
    document.title = this._initialTitle;
  },

  // ---------------------------------------------------------------- estado por modo

  _applyMode(mode) {
    this.mode = mode;
    this._overlayOpen = false;
    document.documentElement.dataset.shellMode = mode;

    if (mode !== 'mobile') {
      this.closeMore(false);
    }

    this._renderState();
  },

  // Sincroniza o modo com a viewport atual (compatibilidade com App.UI.syncResponsiveLayout).
  sync() {
    const mode = this._watch?.mode();

    if (mode && mode !== this.mode) {
      this._applyMode(mode);
    }
  },

  _stateForMode() {
    switch (this.mode) {
      case 'desktop':
        return this._collapsed ? 'collapsed' : 'expanded';
      case 'notebook':
        return this._overlayOpen ? 'open' : 'collapsed';
      case 'tablet':
        return this._overlayOpen ? 'open' : 'closed';
      default:
        return 'closed';
    }
  },

  _renderState() {
    const aside = this.$('main-sidebar');
    const overlay = this.$('sidebar-overlay');
    const toggle = this.$('btn-sidebar-toggle');
    const state = this._stateForMode();
    const overlayMode = this.mode === 'tablet' || this.mode === 'notebook';
    const expanded = state === 'expanded' || state === 'open';

    document.documentElement.dataset.sidebarCollapsed = String(
      this.mode === 'desktop' && this._collapsed
    );

    if (aside) {
      aside.dataset.state = state;
    }

    if (overlay) {
      overlay.classList.toggle('hidden', !(overlayMode && this._overlayOpen));
    }

    if (toggle) {
      toggle.setAttribute('aria-expanded', String(expanded));

      if (this.mode === 'desktop') {
        toggle.title = expanded ? 'Recolher menu lateral' : 'Expandir menu lateral';
      } else {
        toggle.title = expanded ? 'Fechar menu' : 'Abrir menu';
      }
    }
  },

  toggleSidebar() {
    window.App?.UI?.closeUserMenu?.();

    if (this.mode === 'desktop') {
      this._collapsed = !this._collapsed;
      writeCollapsed(this._collapsed);
      this._renderState();
    } else if (this.mode === 'notebook' || this.mode === 'tablet') {
      if (this._overlayOpen) {
        this.closeOverlay();
      } else {
        this.openOverlay();
      }
    }
  },

  isOverlayOpen() {
    return this._overlayOpen;
  },

  openOverlay() {
    if (this.mode !== 'notebook' && this.mode !== 'tablet') {
      return;
    }

    window.App?.UI?.closeUserMenu?.();
    this._overlayOpen = true;
    this._renderState();

    const aside = this.$('main-sidebar');
    const target = aside?.querySelector('[aria-current="page"]') ?? aside?.querySelector(FOCUSABLE);

    target?.focus();
  },

  closeOverlay({ restoreFocus = true } = {}) {
    if (!this._overlayOpen) {
      return;
    }

    const aside = this.$('main-sidebar');
    const focusInside = Boolean(aside?.contains(document.activeElement));

    this._overlayOpen = false;
    this._renderState();

    if (restoreFocus && focusInside) {
      this.$('btn-sidebar-toggle')?.focus();
    }
  },

  // Compatibilidade com App.UI.setMobileSidebarState / ResponsiveManager.
  setOverlayOpen(isOpen) {
    if (isOpen) {
      this.openOverlay();
    } else {
      this.closeOverlay();
    }
  },

  // ---------------------------------------------------------------- "Mais" (mobile)

  openMore() {
    const sheet = this.$('more-sheet');

    if (!sheet || sheet.open || this.mode !== 'mobile') {
      return;
    }

    window.App?.UI?.closeUserMenu?.();
    sheet.showModal();
    this.$('bnav-more')?.setAttribute('aria-expanded', 'true');
  },

  closeMore(restoreFocus = true) {
    const sheet = this.$('more-sheet');

    if (sheet?.open) {
      sheet.close();
    }

    this.$('bnav-more')?.setAttribute('aria-expanded', 'false');

    if (restoreFocus) {
      this.$('bnav-more')?.focus();
    }
  },

  // ---------------------------------------------------------------- eventos

  _bindEvents() {
    this.$('btn-sidebar-toggle')?.addEventListener('click', () => this.toggleSidebar());
    this.$('sidebar-overlay')?.addEventListener('click', () => this.closeOverlay());

    // Escolher um destino fecha o drawer / o rail expandido.
    this.$('sidebar-nav')?.addEventListener('click', (event) => {
      if (event.target.closest('a[data-nav-id]')) {
        this.closeOverlay();
      }
    });

    this.$('bottom-nav')?.addEventListener('click', (event) => {
      if (event.target.closest('#bnav-more')) {
        this.openMore();
      }
    });

    const sheet = this.$('more-sheet');

    sheet?.addEventListener('click', (event) => {
      if (event.target.closest('[data-more-close], a[data-nav-id]')) {
        this.closeMore(false);
        return;
      }

      const action = event.target.closest('[data-more-action]')?.dataset.moreAction;

      if (action) {
        this.closeMore(false);
        this._runAccountAction(action);
      }
    });
    sheet?.addEventListener('close', () => {
      this.$('bnav-more')?.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('keydown', (event) => this._onKeydown(event));
  },

  _runAccountAction(action) {
    const app = window.App;

    if (action === 'profile') {
      app?.Auth?.openProfileModal?.();
    } else if (action === 'password') {
      app?.Auth?.openPasswordModal?.();
    } else if (action === 'theme') {
      app?.UI?.toggleDarkMode?.();
    } else if (action === 'logout') {
      app?.Auth?.logout?.();
    }
  },

  _onKeydown(event) {
    if (!this._overlayOpen) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeOverlay();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    // Foco preso no drawer enquanto ele estiver aberto.
    const aside = this.$('main-sidebar');
    const focusable = [...(aside?.querySelectorAll(FOCUSABLE) ?? [])].filter(
      (node) => node.offsetParent !== null
    );

    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!aside.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
};
