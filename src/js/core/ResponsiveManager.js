/**
 * ResponsiveManager - Gerencia responsividade de layout e performance
 * Handles resize events, breakpoints, observers, e otimizações de touch
 */
export const ResponsiveManager = {
  // Breakpoints em pixels
  breakpoints: {
    xs: 375,
    sm: 480,
    md: 768,
    lg: 1024,
    xl: 1536
  },

  // Estado atual
  currentBreakpoint: null,
  isTouch: false,
  observers: [],
  listeners: [],

  /**
   * Inicializa o gerenciador responsivo
   */
  init: function () {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    this.detectDevice();
    this.setupResizeListener();
    this.setupTouchDetection();
    this.setupIntersectionObservers();
    this.setupResizeObservers();
    this.optimizeForDevice();

    console.log('✓ ResponsiveManager inicializado');
  },

  /**
   * Detecta o tipo de dispositivo
   */
  detectDevice: function () {
    const w = window.innerWidth;

    let newBreakpoint = 'xs';
    if (w >= this.breakpoints.xl) {
      newBreakpoint = 'xl';
    } else if (w >= this.breakpoints.lg) {
      newBreakpoint = 'lg';
    } else if (w >= this.breakpoints.md) {
      newBreakpoint = 'md';
    } else if (w >= this.breakpoints.sm) {
      newBreakpoint = 'sm';
    }

    if (newBreakpoint !== this.currentBreakpoint) {
      const oldBreakpoint = this.currentBreakpoint;
      this.currentBreakpoint = newBreakpoint;

      // Disparar evento customizado
      window.dispatchEvent(
        new CustomEvent('breakpointChange', {
          detail: { old: oldBreakpoint, new: newBreakpoint, width: w }
        })
      );

      // Aplicar classes ao document
      document.documentElement.setAttribute('data-breakpoint', newBreakpoint);
    }

    return this.currentBreakpoint;
  },

  /**
   * Detecta se é um dispositivo com touch
   */
  setupTouchDetection: function () {
    const isTouchDevice = () =>
      window.matchMedia('(pointer:coarse)').matches ||
      navigator.maxTouchPoints > 0 ||
      navigator.msMaxTouchPoints > 0;

    this.isTouch = isTouchDevice();
    document.documentElement.setAttribute('data-touch', this.isTouch ? 'true' : 'false');

    // Adicionar listeners para swipe em mobile
    if (this.isTouch) {
      this.setupSwipeHandling();
      this.optimizeTouchInteractions();
    }
  },

  /**
   * Setup para detecção de swipe (apenas para fechar a sidebar)
   */
  setupSwipeHandling: function () {
    let touchStartX = 0;
    let touchEndX = 0;

    document.addEventListener(
      'touchstart',
      (e) => {
        touchStartX = e.changedTouches[0].screenX;
      },
      false
    );

    document.addEventListener(
      'touchend',
      (e) => {
        touchEndX = e.changedTouches[0].screenX;
        this.handleSwipe(touchStartX, touchEndX);
      },
      false
    );
  },

  /**
   * Processa swipes
   */
  handleSwipe: function (startX, endX) {
    const diffX = startX - endX;
    const threshold = 50; // Pixel threshold for swipe

    // A abertura da sidebar acontece exclusivamente pelo botão hambúrguer.
    // O swipe da esquerda para a direita foi removido porque o scroll vertical
    // no iPhone deriva horizontalmente e satisfazia o limite, abrindo a sidebar
    // sem o usuário pedir.
    if (diffX > threshold) {
      // Swipe da direita para esquerda: fecha o drawer/rail expandido (no-op se já estiver fechado).
      window.App?.Shell?.closeOverlay({ restoreFocus: false });
    }
  },

  /**
   * Otimiza interações em touch
   */
  optimizeTouchInteractions: function () {
    // Aumentar clicabilidade de elementos em touch
    const style = document.createElement('style');
    style.textContent = `
      @media (hover: none) and (pointer: coarse) {
        button, [role="button"], a, .clickable {
          touch-action: manipulation;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: rgba(37, 99, 235, 0.1);
        }
        
        input[type="checkbox"],
        input[type="radio"] {
          accent-color: #2563eb;
        }
        
        select {
          font-size: 16px;
        }
      }
    `;
    document.head.appendChild(style);
  },

  /**
   * Setup do listener de resize com debounce
   */
  setupResizeListener: function () {
    let resizeTimeout;

    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.detectDevice();

        // Disparar evento de resize customizado
        window.dispatchEvent(
          new CustomEvent('responsiveResize', {
            detail: { width: window.innerWidth, height: window.innerHeight }
          })
        );
      }, 150); // Debounce de 150ms
    });

    // Também detectar mudanças de orientação
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        this.detectDevice();
      }, 100);
    });
  },

  /**
   * Setup de Intersection Observer para lazy loading
   */
  setupIntersectionObservers: function () {
    const observerOptions = {
      root: null,
      rootMargin: '50px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          this.loadElement(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Observar elementos lazy
    document.querySelectorAll('[data-lazy="true"]').forEach((el) => {
      observer.observe(el);
    });

    this.observers.push(observer);
  },

  /**
   * Carrega elemento lazy
   */
  loadElement: function (el) {
    // Se for imagem
    if (el.tagName === 'IMG') {
      if (el.dataset.src) {
        el.src = el.dataset.src;
        el.removeAttribute('data-src');
      }
      if (el.dataset.srcset) {
        el.srcset = el.dataset.srcset;
        el.removeAttribute('data-srcset');
      }
    } else if (el.tagName === 'IFRAME') {
      // Se for iframe
      if (el.dataset.src) {
        el.src = el.dataset.src;
        el.removeAttribute('data-src');
      }
    } else if (el.dataset.bg) {
      // Se for div com background
      el.style.backgroundImage = `url(${el.dataset.bg})`;
      el.removeAttribute('data-bg');
    }

    el.classList.remove('lazy');
    el.classList.add('lazy-loaded');
  },

  /**
   * Setup de ResizeObserver para elementos dinâmicos
   */
  setupResizeObservers: function () {
    // Observar mudanças de tamanho do conteúdo principal
    const mainContent = document.getElementById('main-content-scroll');
    if (mainContent && window.ResizeObserver) {
      const resizeObserver = new ResizeObserver((entries) => {
        entries.forEach((entry) => {
          // Disparar evento de mudança de tamanho
          window.dispatchEvent(
            new CustomEvent('contentResized', {
              detail: {
                width: entry.contentRect.width,
                height: entry.contentRect.height
              }
            })
          );
        });
      });

      resizeObserver.observe(mainContent);
      this.observers.push(resizeObserver);
    }

    // Observar sidebar para mudanças
    const sidebar = document.getElementById('main-sidebar');
    if (sidebar && window.ResizeObserver) {
      const sidebarResizeObserver = new ResizeObserver((entries) => {
        entries.forEach((entry) => {
          // Ajustar layout quando sidebar mudar de tamanho
          const width = entry.contentRect.width;
          document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
        });
      });

      sidebarResizeObserver.observe(sidebar);
      this.observers.push(sidebarResizeObserver);
    }
  },

  /**
   * Otimizações específicas por dispositivo
   */
  optimizeForDevice: function () {
    if (this.currentBreakpoint === 'xs' || this.currentBreakpoint === 'sm') {
      // Mobile: reduzir animações para melhor performance
      this.reduceMotion();
    }

    // Detectar modo economia de dados
    if (navigator.connection?.saveData) {
      console.log('Modo economia de dados detectado');
      document.documentElement.setAttribute('data-save-data', 'true');
    }
  },

  /**
   * Reduzir animações em dispositivos com processamento limitado
   */
  reduceMotion: function () {
    const style = document.createElement('style');
    style.textContent = `
      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
          scroll-behavior: auto !important;
        }
      }
      
      @media (max-width: 767px) {
        .tool-card {
          animation: none !important;
        }
        
        .animate-fade-in {
          animation: none;
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);
  },

  /**
   * Get o breakpoint atual
   */
  getCurrentBreakpoint: function () {
    return this.currentBreakpoint;
  },

  /**
   * Check se é mobile
   */
  isMobile: function () {
    return this.currentBreakpoint === 'xs' || this.currentBreakpoint === 'sm';
  },

  /**
   * Check se é tablet
   */
  isTablet: function () {
    return this.currentBreakpoint === 'md';
  },

  /**
   * Check se é desktop
   */
  isDesktop: function () {
    return this.currentBreakpoint === 'lg' || this.currentBreakpoint === 'xl';
  },

  /**
   * Get dimensões visíveis
   */
  getViewportSize: function () {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      breakpoint: this.currentBreakpoint,
      isTouch: this.isTouch
    };
  },

  /**
   * Limpar observers ao desmontar
   */
  destroy: function () {
    this.observers.forEach((observer) => {
      if (observer?.disconnect) {
        observer.disconnect();
      }
    });
    this.observers = [];
    this._initialized = false;
  }
};
