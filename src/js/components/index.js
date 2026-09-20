/**
 * Componentes fundamentais do design system (Gate 1-E). Ponto único de import.
 * Vanilla JS + CSS de src/css/components.css (tokens do 1-C). Sem biblioteca.
 */
export { esc, cx, attrs, icon, uid } from './util.js';
export { Button, IconButton, setBusy, isBusy, BUTTON_VARIANTS, BUTTON_SIZES } from './actions.js';
export { Input, Select, Search, Checkbox, Switch, bindFieldValidation } from './forms.js';
export {
  Badge,
  StatusBadge,
  Card,
  StatCard,
  Alert,
  EmptyState,
  Skeleton,
  SkeletonCard,
  STATUS_MAP,
  TONES
} from './display.js';
export {
  initModals,
  ModalShell,
  confirmDialog,
  Dropdown,
  isDismissible,
  isDirty
} from './overlays.js';
