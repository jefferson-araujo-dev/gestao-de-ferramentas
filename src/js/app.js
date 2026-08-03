import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  clearIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

import { AppAuth } from './modules/auth.js';
import { AppData } from './modules/data.js';
import { AppUI } from './modules/ui.js';
import { AppSession } from './modules/session.js';
import { AppScanner } from './modules/scanner.js';
import { ResponsiveManager } from './core/ResponsiveManager.js';
import {
  debounce,
  withTimeout,
  removeAccents,
  escapeHTML,
  loadScript,
  formatDate,
  compressImageToBase64,
  getBadgeHTML,
  getSkeletonHTML,
  getEmptyStateHTML,
  Logger,
  AudioSys
} from './utils/AdvancedUtils.js';
import { AppCRUDUsers } from './modules/users.js';
import { AppCRUDTools } from './modules/tools.js';
import { AppCRUDCollaborators } from './modules/collaborators.js';
import { AppPDF } from './modules/pdf.js';
import { CONFIG, DB_BASE_PATH, COLLECTIONS, FIREBASE_CONFIG } from './config/constants.js';

export { CONFIG, DB_BASE_PATH, COLLECTIONS };

// 2. Utils & Logger (Inlined from utils.js)
const Utils = Object.freeze({
  debounce,
  withTimeout,
  removeAccents,
  escapeHTML,
  loadScript,
  formatDate,
  compressImageToBase64,
  getBadgeHTML,
  getSkeletonHTML,
  getEmptyStateHTML
});

// 3. Firebase Setup
const firebaseApp = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(firebaseApp);
auth.languageCode = 'pt-BR';
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentSingleTabManager()
  })
});

window.addEventListener('unhandledrejection', async (event) => {
  const msg = event.reason?.message || '';
  if (
    msg.includes('corruption of the IndexedDB') ||
    msg.includes('Version change transaction was aborted')
  ) {
    event.preventDefault();
    try {
      await clearIndexedDbPersistence(db);
      window.location.reload();
    } catch (e) {
      Logger.error('Falha ao limpar cache do IndexedDB', e);
    }
  }
});

const App = {
  Auth: AppAuth,
  Session: AppSession,
  Data: AppData,
  UI: AppUI,
  Scanner: AppScanner,
  CRUDTools: AppCRUDTools,
  CRUDUsers: AppCRUDUsers,
  CRUDCollaborators: AppCRUDCollaborators,
  Responsive: ResponsiveManager,
  PDF: AppPDF,
  init: function () {
    this.Responsive.init(); // Inicializar ResponsiveManager primeiro
    this.Auth.init();
    this.UI.init();
    this.Scanner.init();
  }
};
window.App = App;
window.Utils = Utils;
window.Logger = Logger;
window.AudioSys = AudioSys;

document.addEventListener('DOMContentLoaded', () => {
  // Registrar Service Worker para PWA (Funcionamento Offline)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js', { type: import.meta.env.DEV ? 'module' : 'classic' })
      .then((reg) => window.Logger.info('PWA: ServiceWorker ativado com sucesso!', reg.scope))
      .catch((err) => window.Logger.warn('PWA: Falha ao registrar ServiceWorker', err));

    // Atualizar a página automaticamente quando uma nova versão assumir o controle
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.Logger.info('Nova versão do sistema detectada. Atualizando tela...');
        setTimeout(() => {
          window.location.reload();
        }, 1500); // Pequeno delay para o Toast aparecer antes de recarregar
      }
    });
  }

  // Lógica de Instalação do PWA
  let deferredPrompt;
  const installBtn = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    // Previne que o mini-infobar apareça no mobile (opcional)
    e.preventDefault();
    deferredPrompt = e;
    // Mostra o botão
    if (installBtn) {
      installBtn.classList.remove('hidden');
    }
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) {
        return;
      }
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      window.Logger.info(`PWA Instalação: ${outcome}`);
      deferredPrompt = null;
      installBtn.classList.add('hidden');
    });
  }

  window.addEventListener('appinstalled', () => {
    if (installBtn) {
      installBtn.classList.add('hidden');
    }
    deferredPrompt = null;
    window.Logger.info('PWA instalado com sucesso!');
  });

  // Inicializar App
  App.init();

  // Event listener para mudanças de breakpoint
  window.addEventListener('breakpointChange', () => {
    App.UI.syncResponsiveLayout();
  });

  // Event listener para resize responsivo
  window.addEventListener('responsiveResize', () => {
    if (window.App?.UI?.activeTab === 'dashboard') {
      window.App.UI.renderDashboard();
    }
  });
});
