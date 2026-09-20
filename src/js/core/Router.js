import { hashForRoute, routeFromHash } from '../config/navigation.js';

/**
 * Roteador leve por hash (#/painel, #/ferramentas...), sem biblioteca.
 *
 * Responsabilidade única: manter a URL e avisar mudanças. Ele NÃO conhece telas, perfis nem DOM;
 * quem aplica a rota (e recusa rotas não autorizadas) é App.UI.applyRoute.
 * - write() usa history.pushState/replaceState (não dispara hashchange): navegação programática
 *   é síncrona e não gera evento duplicado.
 * - back/forward e edição manual do hash chegam por "hashchange".
 */
export const Router = {
  _listening: false,
  _onChange: null,
  _handler: null,

  current() {
    return routeFromHash(window.location.hash);
  },

  // Começa a observar. Não aplica a rota atual: o chamador decide (App.UI.startRouting).
  start(onChange) {
    this._onChange = onChange;

    if (this._listening) {
      return;
    }

    this._handler = () => this._onChange?.(this.current(), { source: 'hashchange' });
    window.addEventListener('hashchange', this._handler);
    this._listening = true;
  },

  stop() {
    if (this._handler) {
      window.removeEventListener('hashchange', this._handler);
    }

    this._handler = null;
    this._onChange = null;
    this._listening = false;
  },

  // Escreve a rota na URL. Retorna false quando já era a rota atual (nada a fazer).
  write(route, { replace = false } = {}) {
    if (this.current() === route) {
      return false;
    }

    const { pathname, search } = window.location;
    const url = `${pathname}${search}${hashForRoute(route)}`;

    if (replace) {
      window.history.replaceState(window.history.state, '', url);
    } else {
      window.history.pushState(window.history.state, '', url);
    }

    return true;
  },

  // Remove o hash sem criar entrada de histórico (logout / tela de login).
  clear() {
    const { pathname, search } = window.location;

    window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  }
};
