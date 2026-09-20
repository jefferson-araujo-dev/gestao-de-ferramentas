import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  updatePassword,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { auth, db, DB_BASE_PATH, COLLECTIONS } from '../app.js';
import { cacheManager } from '../core/CacheManager.js';
import { metrics } from '../core/MetricsManager.js';

export const AppAuth = {
  _initialized: false,
  isAdm: false,
  isRestricted: false,
  uName: null,
  permissions: {
    canAccessDashboard: false,
    canAccessScanner: false,
    canReadTools: false,
    canReadCollaborators: false,
    canAccessInventory: false,
    canAccessUsers: false,
    canAccessHistory: false,
    canExportData: false,
    canBackupData: false,
    canManageCollaborators: false,
    canManageTools: false,
  },
  _setPermissions: function (isAdm, isAuthenticated = true, isRestricted = false) {
    const canAccessStandardModules = isAuthenticated === true;

    this.permissions.canAccessDashboard = canAccessStandardModules;
    this.permissions.canAccessScanner = canAccessStandardModules;
    this.permissions.canReadTools = canAccessStandardModules;
    // Perfil restrito não lê colaboradores (nem lista, nem tela): empresta pelo crachá no servidor.
    this.permissions.canReadCollaborators = canAccessStandardModules && isRestricted !== true;
    this.permissions.canAccessInventory = isAdm;
    this.permissions.canAccessUsers = isAdm;
    this.permissions.canAccessHistory = isAdm;
    this.permissions.canExportData = isAdm;
    this.permissions.canBackupData = isAdm;
    this.permissions.canManageCollaborators = isAdm;
    this.permissions.canManageTools = isAdm;
  },
  _updateAdministrativeActionVisibility: function () {
    const visibilityById = {
      'btn-export-dashboard': this.permissions.canExportData,
      'btn-collaborators-export': this.permissions.canExportData,
      'btn-collaborators-import': this.permissions.canManageCollaborators,
      'btn-collaborators-new': this.permissions.canManageCollaborators,
    };

    Object.entries(visibilityById).forEach(([id, isVisible]) => {
      const element = document.getElementById(id);
      if (element) {
        element.style.display = isVisible ? '' : 'none';
      }
    });
  },
  init: function () {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    document.getElementById('toggle-password')?.addEventListener('click', () => {
      this.togglePasswordVisibility('login-password', 'toggle-password');
    });

    document.getElementById('btn-forgot-password')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openForgotModal();
    });

    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const em = document.getElementById('login-email').value,
        p = document.getElementById('login-password').value;
      const btn = document.getElementById('btn-login');
      if (btn) {
        btn.disabled = true;
      }
      document.getElementById('login-text').innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 mr-2 animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Autenticando...';
      try {
        await signInWithEmailAndPassword(auth, em, p);
        metrics.trackAction('auth', 'login_success');
      } catch (err) {
        window.Logger.error('Acesso Negado.', err);
        if (btn) {
          btn.disabled = false;
        }
        document.getElementById('login-text').textContent = 'Acessar Sistema';
        metrics.trackAction('auth', 'login_error', err.code);
      }
    });

    onAuthStateChanged(auth, (user) => {
      if (user) {
        this._handleAuthenticatedUser(user);
      } else {
        this._handleUnauthenticatedUser();
      }
    });
  },
  async _handleAuthenticatedUser(user) {
    try {
      const userProfile = await this._fetchAndCacheUserProfile(user);
      const { uName, isAdm, isRestricted } = userProfile;

      await this._updateUserSession();
      this._updateUIForUser(uName, isAdm, isRestricted);

      document.getElementById('login-screen')?.classList.add('hidden');
      document.getElementById('main-app')?.classList.remove('hidden');
      window.App.Data.init(this.permissions);
      window.App.Session.init();
      // Roteamento por hash só depois de perfil e permissões aplicados (deep link/reload preservados).
      window.App.UI.startRouting();

      const loginPasswordField = document.getElementById('login-password');
      if (loginPasswordField) {
        loginPasswordField.value = '';
      }
    } catch (err) {
      window.Logger.error('Acesso negado.', err);

      await signOut(auth);

      window.App.UI?.showToast?.(
        err.message || 'Usuário sem permissão para acessar o sistema.',
        'error'
      );
    }
  },
  _handleUnauthenticatedUser() {
    this.isAdm = false;
    this.isRestricted = false;
    this._setPermissions(false, false);
    this._updateAdministrativeActionVisibility();
    window.App.Shell?.applyPermissions(null);
    window.App.UI?.stopRouting();
    document.getElementById('login-screen')?.classList.remove('hidden');
    document.getElementById('main-app')?.classList.add('hidden');
    window.App.Session.cleanup();
    window.App.Data.destroyListeners();
    const loginButton = document.getElementById('btn-login');
    if (loginButton) {
      loginButton.disabled = false;
    }
    const loginText = document.getElementById('login-text');
    if (loginText) {
      loginText.textContent = 'Acessar Sistema';
    }
  },
  async _fetchAndCacheUserProfile(user) {
    const cacheKey = `user_profile_${user.uid}`;

    const matchedDoc = await cacheManager.getOrSet(
      cacheKey,
      async () => {
        const ref = doc(db, DB_BASE_PATH, COLLECTIONS.USERS, user.uid);
        const snap = await getDoc(ref);

        return snap.exists() ? { id: snap.id, data: snap.data() } : null;
      },
      { ttl: 900000 } // TTL de 15 minutos
    );

    if (!matchedDoc) {
      throw new Error('Seu acesso ainda não foi autorizado pelo administrador.');
    }

    const dbUser = matchedDoc.data;

    if (dbUser.status !== 'Ativo') {
      throw new Error('Seu usuário está inativo.');
    }

    const profileEmail = String(dbUser.email || '')
      .trim()
      .toLowerCase();
    const authenticatedEmail = String(user.email || '')
      .trim()
      .toLowerCase();

    if (!profileEmail || profileEmail !== authenticatedEmail) {
      throw new Error('O perfil não corresponde à conta autenticada.');
    }

    const nameParts = String(dbUser.name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const uName =
      nameParts.length > 1
        ? `${nameParts[0]} ${nameParts[nameParts.length - 1]}`
        : nameParts[0] || 'Usuário';

    return {
      id: matchedDoc.id,
      uName,
      isAdm: dbUser.accessLevel === 'Administrador',
      isRestricted: dbUser.isRestricted === true,
    };
  },
  async _updateUserSession() {
    const ua = String(navigator.userAgent || '');
    let os = 'OS Desconhecido',
      browser = 'Navegador Desconhecido';
    if (ua.includes('Win')) {
      os = 'Windows';
    } else if (ua.includes('Mac')) {
      os = 'MacOS';
    }
    if (ua.includes('Edg')) {
      browser = 'Edge';
    } else if (ua.includes('Chrome')) {
      browser = 'Chrome';
    }

    const device = `${browser} / ${os}`.trim().slice(0, 160);

    try {
      const currentUser = auth.currentUser;

      if (!currentUser) {
        window.Logger.warn('Não foi possível atualizar último login: usuário não autenticado.');
        return;
      }

      const token = await currentUser.getIdToken();
      const response = await fetch('/api/session/last-login', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device,
        }),
        cache: 'no-store',
      });

      let result = null;

      try {
        result = await response.json();
      } catch {
        result = null;
      }

      if (!response.ok) {
        const message =
          typeof result?.message === 'string' && result.message.trim()
            ? result.message.trim()
            : 'Não foi possível atualizar o último login.';

        throw new Error(message);
      }

      if (window.App?.Session) {
        window.App.Session.currentDevice = device;
        window.App.Session.currentIp = 'Registrado no servidor';
      }
    } catch (error) {
      window.Logger.warn('Erro ao atualizar último login pela API:', error);
    }
  },
  _updateUIForUser(uName, isAdm, isRestricted) {
    this.isAdm = isAdm;
    this.isRestricted = isRestricted === true && !isAdm;
    this.uName = uName;
    this._setPermissions(isAdm, true, this.isRestricted);
    this._updateAdministrativeActionVisibility();
    document.getElementById('user-name').textContent = uName;
    document.getElementById('user-role').textContent = isAdm ? 'Administrador' : 'Usuário';
    document.getElementById('user-avatar').innerHTML = isAdm
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 text-brand-600"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 text-brand-600"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

    // Navegação (sidebar, barra inferior, "Mais"): itens derivados do modelo central + permissões.
    window.App.Shell.applyPermissions(this.permissions);
    document.getElementById('tools-action-export').style.display = isAdm ? '' : 'none';
    document.getElementById('tools-action-import').style.display = isAdm ? '' : 'none';
    document.getElementById('tools-action-new').style.display = isAdm ? '' : 'none';
    document.getElementById('crud-import-input-tool').style.display = isAdm ? '' : 'none';
  },
  logout: function (force = false) {
    if (force === true) {
      metrics.trackAction('auth', 'logout');
      window.App.Session.cleanup();
      signOut(auth);
    } else {
      const m = document.getElementById('logout-modal');
      if (m) {
        m.showModal();
      }
    }
  },
  closeLogoutModal: function () {
    const m = document.getElementById('logout-modal');
    if (m) {
      m.close();
    }
  },
  confirmLogout: function () {
    this.closeLogoutModal();
    this.logout(true);
  },
  openProfileModal: function () {
    const m = document.getElementById('profile-modal');
    if (m) {
      const name = this.uName || 'Usuário';
      const role = this.isAdm ? 'Administrador' : 'Usuário';
      const email = auth.currentUser?.email || 'Sem e-mail';
      const ip = window.App.Session.currentIp || 'Desconhecido';
      const device = window.App.Session.currentDevice || 'Desconhecido';
      const n = document.getElementById('profile-modal-name');
      const r = document.getElementById('profile-modal-role');
      const e = document.getElementById('profile-modal-email');
      const i = document.getElementById('profile-modal-ip');
      const d = document.getElementById('profile-modal-device');
      const ll = document.getElementById('profile-modal-last-login');
      const ac = document.getElementById('profile-modal-account-created');
      const avatarContainer = document.getElementById('profile-modal-avatar');

      if (n) {
        n.textContent = name;
      }
      if (r) {
        r.textContent = role;
      }
      if (e) {
        e.textContent = email;
        e.title = email;
      }
      if (i) {
        i.textContent = ip;
      }
      if (d) {
        d.textContent = device;
      }

      const currentUserData = window.App.Data.users.find((u) => u.email === email);

      if (ll) {
        ll.textContent =
          currentUserData && currentUserData.lastLogin
            ? window.Utils.formatDate(currentUserData.lastLogin)
            : 'Sem registro';
      }

      if (ac) {
        ac.textContent =
          currentUserData && currentUserData.createdAt
            ? window.Utils.formatDate(currentUserData.createdAt)
            : 'Não disponível';
      }

      if (avatarContainer) {
        if (currentUserData && currentUserData.avatar) {
          avatarContainer.innerHTML = `<img src="${currentUserData.avatar}" class="w-full h-full object-cover" alt="${window.Utils.escapeHTML(name)}">`;
        } else {
          const initials = name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
          avatarContainer.innerHTML = `<span class="text-2xl font-bold">${initials}</span>`;
        }
      }

      m.scrollTop = 0;
      const scrollable = m.querySelector('.overflow-y-auto');
      if (scrollable) {
        scrollable.scrollTop = 0;
      }

      m.showModal();
    }
  },
  closeProfileModal: function () {
    const m = document.getElementById('profile-modal');
    if (m) {
      m.close();
    }
  },
  openPasswordModal: function () {
    const m = document.getElementById('password-modal');
    if (m) {
      m.showModal();
    }
    const newPass = document.getElementById('new-password');
    const confirmPass = document.getElementById('confirm-password');
    if (newPass) {
      newPass.value = '';
      newPass.type = 'password';
      newPass.oninput = () => {
        this.checkPasswordStrength(newPass.value);
        this.validatePasswords(newPass.value, confirmPass.value);
      };
      newPass.classList.remove(
        'border-emerald-500',
        'border-rose-500',
        'dark:border-emerald-500',
        'dark:border-rose-500'
      );
    }
    if (confirmPass) {
      confirmPass.value = '';
      confirmPass.type = 'password';
      confirmPass.oninput = () => this.validatePasswords(newPass.value, confirmPass.value);
      confirmPass.classList.remove(
        'border-emerald-500',
        'border-rose-500',
        'dark:border-emerald-500',
        'dark:border-rose-500'
      );
    }
    this.updateStrengthUI(0);
    const matchMsg = document.getElementById('password-match-msg');
    if (matchMsg) {
      matchMsg.textContent = '';
      matchMsg.className = 'text-[10px] font-bold mt-1.5 h-4';
    }
    const btn = document.getElementById('btn-save-password');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'Atualizar';
    }
  },
  togglePasswordVisibility: function (inputId, iconId) {
    const input = document.getElementById(inputId);
    if (!input) {
      return;
    }
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    const iconBtn = document.getElementById(iconId);
    if (iconBtn) {
      const svg = iconBtn.querySelector('svg');
      if (svg) {
        svg.innerHTML = isPassword
          ? '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>'
          : '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
      }
    }
  },
  checkPasswordStrength: function (password) {
    let strength = 0;
    if (password.length >= 8) {
      strength += 1;
    }
    if (password.length >= 12) {
      strength += 1;
    }
    if (/[A-Z]/.test(password)) {
      strength += 1;
    }
    if (/[0-9]/.test(password)) {
      strength += 1;
    }
    if (/[^A-Za-z0-9]/.test(password)) {
      strength += 1;
    }
    this.updateStrengthUI(strength);
    return strength;
  },
  updateStrengthUI: function (strength) {
    const bar = document.getElementById('password-strength-bar');
    const text = document.getElementById('password-strength-text');
    if (!bar || !text) {
      return;
    }
    let width = '0%',
      color = 'bg-red-500',
      label = 'Muito Fraca';
    switch (strength) {
      case 0:
      case 1:
        width = '20%';
        color = 'bg-red-500';
        label = 'Muito Fraca';
        break;
      case 2:
        width = '40%';
        color = 'bg-orange-500';
        label = 'Fraca';
        break;
      case 3:
        width = '60%';
        color = 'bg-yellow-500';
        label = 'Média';
        break;
      case 4:
        width = '80%';
        color = 'bg-blue-500';
        label = 'Forte';
        break;
      case 5:
        width = '100%';
        color = 'bg-emerald-500';
        label = 'Muito Forte';
        break;
    }
    bar.style.width = width;
    bar.className = bar.className.replace(/bg-\w+-500/g, '');
    bar.classList.add(color);
    text.textContent = label;
    text.className = `text-[10px] font-bold mt-1 text-right uppercase ${color.replace('bg-', 'text-')}`;
  },
  validatePasswords: function (newPass, confirmPass) {
    const msg = document.getElementById('password-match-msg');
    const btn = document.getElementById('btn-save-password');
    const newPassInput = document.getElementById('new-password');
    const confirmPassInput = document.getElementById('confirm-password');
    if (!msg || !btn || !newPassInput || !confirmPassInput) {
      return;
    }
    newPassInput.classList.remove(
      'border-emerald-500',
      'border-rose-500',
      'border-slate-200',
      'dark:border-slate-700'
    );
    confirmPassInput.classList.remove(
      'border-emerald-500',
      'border-rose-500',
      'border-slate-200',
      'dark:border-slate-700'
    );
    if (!confirmPass) {
      msg.textContent = '';
      btn.disabled = true;
      confirmPassInput.classList.add('border-slate-200', 'dark:border-slate-700');
      return;
    }
    if (newPass === confirmPass) {
      msg.textContent = '✓ As senhas coincidem';
      msg.className = 'text-[10px] font-bold mt-1.5 h-4 text-emerald-500';
      newPassInput.classList.add('border-emerald-500');
      confirmPassInput.classList.add('border-emerald-500');
      btn.disabled = false;
    } else {
      msg.textContent = '✗ As senhas não coincidem';
      msg.className = 'text-[10px] font-bold mt-1.5 h-4 text-rose-500';
      newPassInput.classList.add('border-rose-500');
      confirmPassInput.classList.add('border-rose-500');
      btn.disabled = true;
    }
  },
  closePasswordModal: function () {
    const m = document.getElementById('password-modal');
    if (m) {
      m.close();
    }
  },
  updateUserPassword: async function () {
    const np = document.getElementById('new-password').value,
      cp = document.getElementById('confirm-password').value;
    if (!np || !cp) {
      return window.App.UI.showToast('Preencha todos os campos.', 'error');
    }
    if (np.length < 8) {
      return window.App.UI.showToast('A senha deve ter pelo menos 8 caracteres.', 'error');
    }
    if (np !== cp) {
      return window.App.UI.showToast('As senhas não conferem.', 'error');
    }
    const btn = document.getElementById('btn-save-password');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Atualizando...';
    try {
      if (typeof auth === 'undefined' || !auth || !auth.currentUser) {
        throw new Error('Sessão expirada ou não iniciada.');
      }
      await updatePassword(auth.currentUser, np);
      window.App.UI.showToast('Senha atualizada com sucesso!', 'success');
      this.closePasswordModal();
    } catch (err) {
      window.Logger.error('Erro ao atualizar senha:', err);
      if (err.code === 'auth/requires-recent-login') {
        window.App.UI.showToast('Sessão expirada. Faça login novamente.', 'warning');
        setTimeout(() => this.logout(true), 2500);
      } else if (err.code === 'auth/weak-password') {
        window.App.UI.showToast('A senha é muito fraca ou comum.', 'error');
      } else {
        window.App.UI.showToast(err.message || 'Erro ao atualizar a senha.', 'error');
      }
      btn.disabled = false;
      btn.innerHTML = originalContent;
    }
  },
  openForgotModal: function () {
    const m = document.getElementById('forgot-password-modal');
    if (m) {
      m.showModal();
    }
    const em = document.getElementById('forgot-email-input');
    const loginEm = document.getElementById('login-email');
    if (em && loginEm) {
      em.value = loginEm.value;
    }
  },
  closeForgotModal: function () {
    const m = document.getElementById('forgot-password-modal');
    if (m) {
      m.close();
    }
  },
  sendPasswordAccessEmail: async function (email) {
    const normalizedEmail = String(email || '')
      .trim()
      .toLowerCase();

    if (!normalizedEmail) {
      throw new Error('E-mail inválido.');
    }

    await sendPasswordResetEmail(auth, normalizedEmail);
  },
  sendForgotEmail: async function () {
    const emailInput = document.getElementById('forgot-email-input');

    const email = String(emailInput?.value || '')
      .trim()
      .toLowerCase();

    if (!email) {
      return window.App.UI.showToast('Digite o e-mail cadastrado.', 'warning');
    }

    const button = document.getElementById('btn-send-forgot');

    if (!button) {
      return;
    }

    const originalContent = button.innerHTML;

    button.disabled = true;
    button.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 mr-2 animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Enviando...';

    const genericMessage =
      'Se existir uma conta para este e-mail, as instruções para criar ou redefinir a senha serão enviadas.';

    try {
      await this.sendPasswordAccessEmail(email);

      window.App.UI.showToast(genericMessage, 'success');

      this.closeForgotModal();
    } catch (error) {
      window.Logger.error('Erro ao enviar instruções de acesso.', error);

      if (error?.code === 'auth/user-not-found') {
        window.App.UI.showToast(genericMessage, 'success');

        this.closeForgotModal();
      } else if (error?.code === 'auth/invalid-email') {
        window.App.UI.showToast('Informe um endereço de e-mail válido.', 'warning');
      } else {
        window.App.UI.showToast(
          'Não foi possível enviar as instruções agora. Tente novamente mais tarde.',
          'error'
        );
      }
    } finally {
      button.disabled = false;
      button.innerHTML = originalContent;
    }
  },
};
