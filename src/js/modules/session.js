import { auth, CONFIG } from '../app.js';

export const AppSession = {
  t: null,
  last: 0,
  currentIp: '',
  currentDevice: '',
  sessionListeners: [],
  init: function () {
    this.reset();
    const events = ['mousemove', 'keydown', 'scroll', 'click'];
    events.forEach((e) => {
      const handler = () => this.thr();
      document.addEventListener(e, handler, { passive: true });
      this.sessionListeners.push({ event: e, handler });
    });
  },
  cleanup: function () {
    this.sessionListeners.forEach(({ event, handler }) => {
      document.removeEventListener(event, handler);
    });
    this.sessionListeners = [];
    clearTimeout(this.t);
  },
  thr: function () {
    const n = Date.now();
    if (n - this.last > 2000) {
      this.last = n;
      this.reset();
    }
  },
  reset: function () {
    clearTimeout(this.t);
    this.t = setTimeout(() => {
      if (auth.currentUser) {
        window.App.Auth.logout(true);
        window.App.UI.showToast('Sessão expirada. Faça login novamente.', 'warning', {
          persistent: true
        });
      }
    }, CONFIG.SESSION_LIMIT_MS);
  }
};
