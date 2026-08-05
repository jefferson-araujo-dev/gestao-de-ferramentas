function createViewport(name, width, height, category, tier) {
  return Object.freeze({
    name,
    width,
    height,
    category,
    tier
  });
}

export const RESPONSIVE_VIEWPORTS = Object.freeze([
  createViewport('mobile-280x653', 280, 653, 'mobile', 'core'),
  createViewport('mobile-320x568', 320, 568, 'mobile', 'core'),
  createViewport('mobile-344x882', 344, 882, 'mobile', 'core'),
  createViewport('mobile-360x640', 360, 640, 'mobile', 'core'),
  createViewport('mobile-360x800', 360, 800, 'mobile', 'extended'),
  createViewport('mobile-375x667', 375, 667, 'mobile', 'core'),
  createViewport('mobile-375x812', 375, 812, 'mobile', 'core'),
  createViewport('mobile-390x844', 390, 844, 'mobile', 'core'),
  createViewport('mobile-393x852', 393, 852, 'mobile', 'extended'),
  createViewport('mobile-412x732', 412, 732, 'mobile', 'extended'),
  createViewport('mobile-412x915', 412, 915, 'mobile', 'core'),
  createViewport('mobile-430x932', 430, 932, 'mobile', 'core'),
  createViewport('mobile-480x800', 480, 800, 'mobile', 'extended'),
  createViewport('mobile-540x720', 540, 720, 'mobile', 'extended'),

  createViewport('tablet-600x960', 600, 960, 'tablet', 'core'),
  createViewport('tablet-768x1024', 768, 1024, 'tablet', 'core'),
  createViewport('tablet-800x1280', 800, 1280, 'tablet', 'extended'),
  createViewport('tablet-820x1180', 820, 1180, 'tablet', 'core'),
  createViewport('tablet-912x1368', 912, 1368, 'tablet', 'extended'),
  createViewport('tablet-1024x768', 1024, 768, 'tablet', 'core'),
  createViewport('tablet-1180x820', 1180, 820, 'tablet', 'extended'),

  createViewport('desktop-1280x720', 1280, 720, 'desktop', 'core'),
  createViewport('desktop-1280x800', 1280, 800, 'desktop', 'extended'),
  createViewport('desktop-1366x768', 1366, 768, 'desktop', 'core'),
  createViewport('desktop-1440x900', 1440, 900, 'desktop', 'core'),
  createViewport('desktop-1536x864', 1536, 864, 'desktop', 'extended'),
  createViewport('desktop-1600x900', 1600, 900, 'desktop', 'extended'),
  createViewport('desktop-1920x1080', 1920, 1080, 'desktop', 'core'),
  createViewport('desktop-2560x1440', 2560, 1440, 'desktop', 'extended'),
  createViewport('desktop-3440x1440', 3440, 1440, 'desktop', 'extended')
]);

export const CORE_RESPONSIVE_VIEWPORTS = Object.freeze(
  RESPONSIVE_VIEWPORTS.filter((viewport) => viewport.tier === 'core')
);

export const EXTENDED_RESPONSIVE_VIEWPORTS = Object.freeze(
  RESPONSIVE_VIEWPORTS.filter((viewport) => viewport.tier === 'extended')
);
