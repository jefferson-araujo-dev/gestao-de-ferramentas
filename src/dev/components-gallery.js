import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dropdown,
  EmptyState,
  IconButton,
  Input,
  ModalShell,
  Search,
  Select,
  Skeleton,
  SkeletonCard,
  StatCard,
  StatusBadge,
  Switch,
  bindFieldValidation,
  confirmDialog,
  initModals,
  setBusy
} from '../js/components/index.js';
import { notifications } from '../js/core/NotificationManager.js';

// Galeria de dev/testes (não faz parte do produto). Cada seção tem data-section para os testes.
const params = new URLSearchParams(window.location.search);

if (params.get('theme') === 'dark') {
  document.documentElement.classList.add('dark');
  document.documentElement.classList.remove('light');
}

const section = (id, title, html) =>
  `<section data-section="${id}" class="space-y-3" aria-labelledby="sec-${id}"><h2 id="sec-${id}" class="text-heading-md">${title}</h2>${html}</section>`;

const row = (html) => `<div class="flex flex-wrap items-center gap-3">${html}</div>`;

const sections = [
  section(
    'buttons',
    'Button',
    row(
      ['primary', 'secondary', 'ghost', 'danger']
        .map((variant) => Button({ label: variant, variant, id: `btn-${variant}` }))
        .join('') +
        Button({ label: 'Com ícone', icon: 'icon-download', variant: 'secondary', id: 'btn-icon' }) +
        Button({ label: 'Pequeno', size: 'sm', id: 'btn-sm' }) +
        Button({ label: 'Desabilitado', variant: 'primary', disabled: true, id: 'btn-disabled' }) +
        Button({ label: 'Salvar', variant: 'primary', id: 'btn-loading' }) +
        Button({ label: 'Largura total', variant: 'primary', block: true, id: 'btn-block' })
    )
  ),
  section(
    'icon-buttons',
    'IconButton',
    row(
      IconButton({ label: 'Fechar', icon: 'icon-close', id: 'ib-close' }) +
        IconButton({ label: 'Buscar', icon: 'icon-search', variant: 'ghost', id: 'ib-search' }) +
        IconButton({ label: 'Excluir item', icon: 'icon-close', variant: 'danger', id: 'ib-danger' }) +
        IconButton({ label: 'Indisponível', icon: 'icon-close', disabled: true, id: 'ib-disabled' })
    )
  ),
  section(
    'fields',
    'Input / Select / Search',
    `<form id="gallery-form" class="grid gap-4 md:grid-cols-2" novalidate>${
      Input({ label: 'Nome', id: 'f-name', name: 'name', help: 'Como aparece nos relatórios.', required: true, attributes: { required: true } }) +
      Input({ label: 'E-mail', id: 'f-email', type: 'email', required: true, attributes: { required: true } }) +
      Input({ label: 'Com erro', id: 'f-error', value: 'x', error: 'Informe um valor válido.' }) +
      Input({ label: 'Desabilitado', id: 'f-disabled', value: 'Somente leitura', disabled: true }) +
      Select({
        label: 'Categoria',
        id: 'f-select',
        options: [
          { value: '', label: 'Selecione' },
          { value: 'eletrica', label: 'Elétrica' },
          { value: 'manual', label: 'Manual' }
        ],
        required: true,
        attributes: { required: true }
      }) +
      Search({ label: 'Buscar ferramentas', id: 'f-search', placeholder: 'Nome, patrimônio ou categoria' })
    }</form>`
  ),
  section(
    'toggles',
    'Checkbox / Switch',
    `<div class="space-y-2">${
      Checkbox({ label: 'Aceito os termos', id: 'c-terms' }) +
      Checkbox({ label: 'Marcado', id: 'c-checked', checked: true }) +
      Checkbox({ label: 'Desabilitado', id: 'c-disabled', disabled: true }) +
      Switch({ label: 'Agrupar por setor', id: 's-group' }) +
      Switch({ label: 'Ligado', id: 's-on', checked: true }) +
      Switch({ label: 'Desabilitado', id: 's-disabled', disabled: true })
    }</div>`
  ),
  section(
    'badges',
    'Badge / StatusBadge',
    row(
      ['neutral', 'info', 'success', 'warning', 'danger'].map((tone) => Badge({ label: tone, tone })).join('') +
        ['available', 'borrowed', 'maintenance', 'in', 'out', 'outro <b>&'].map((s) => StatusBadge(s)).join('')
    )
  ),
  section(
    'cards',
    'Card / StatCard',
    `<div class="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">${
      StatCard({ label: 'Total', value: '8', valueId: 'g-stat-total', icon: 'icon-inventory', meta: 'Atualizado hoje', metaIcon: 'icon-history' }) +
      StatCard({ label: 'Disponíveis', value: '4 (50%)', icon: 'icon-scanner', tone: 'success', interactive: true, attributes: { id: 'g-stat-click' } }) +
      StatCard({ label: 'Emprestadas', value: '2 (25%)', icon: 'icon-users', tone: 'warning' }) +
      StatCard({ label: 'Manutenção', value: '2 (25%)', icon: 'icon-history', tone: 'danger' }) +
      Card({ header: '<strong>Card</strong>', body: 'Conteúdo do cartão', footer: 'Rodapé' })
    }</div>`
  ),
  section(
    'alerts',
    'Alert',
    `<div class="space-y-3">${['info', 'success', 'warning', 'danger']
      .map((tone) => Alert({ tone, title: `Alerta ${tone}`, message: 'Mensagem persistente na página.', id: `alert-${tone}` }))
      .join('')}</div>`
  ),
  section(
    'empty-skeleton',
    'EmptyState / Skeleton',
    `<div class="grid gap-4 md:grid-cols-2">${
      EmptyState({ title: 'Nenhuma ferramenta encontrada', description: 'Ajuste os filtros ou cadastre uma nova ferramenta.', action: Button({ label: 'Limpar filtros', variant: 'secondary' }), attributes: { id: 'g-empty' } }) +
      `<div id="g-skeleton" class="space-y-3">${SkeletonCard()}${Skeleton({ width: '60%' })}</div>`
    }</div>`
  ),
  section(
    'overlays',
    'Modal / ConfirmDialog / Toast / Dropdown',
    row(
      Button({ label: 'Abrir modal dispensável', id: 'open-modal-dismissible' }) +
        Button({ label: 'Abrir formulário (não dispensável)', id: 'open-modal-form' }) +
        Button({ label: 'Confirmar (padrão)', id: 'open-confirm' }) +
        Button({ label: 'Confirmar (perigo)', variant: 'danger', id: 'open-confirm-danger' }) +
        Button({ label: 'Confirmar (reforçado)', variant: 'danger', id: 'open-confirm-strong' }) +
        Button({ label: 'Confirmar (falha)', id: 'open-confirm-fail' }) +
        Button({ label: 'Toast sucesso', id: 'toast-success' }) +
        Button({ label: 'Toast erro', id: 'toast-error' }) +
        Button({ label: 'Toast aviso', id: 'toast-warning' }) +
        Button({ label: 'Toast info', id: 'toast-info' }) +
        '<div class="relative" data-dropdown><button type="button" id="dd-trigger" class="ui-btn ui-btn--secondary">Ações</button><div id="dd-panel" class="ui-menu"><button type="button" role="menuitem" class="ui-menu__item" id="dd-edit">Editar</button><button type="button" role="menuitem" class="ui-menu__item" id="dd-copy">Duplicar</button><hr class="ui-menu__sep" /><button type="button" role="menuitem" class="ui-menu__item ui-menu__item--danger" id="dd-delete">Excluir</button></div></div>'
    ) +
      '<p id="gallery-result" class="ui-help" role="status" aria-live="polite"></p>'
  )
];

document.getElementById('gallery').insertAdjacentHTML('beforeend', sections.join(''));

// Modais da galeria
document.body.insertAdjacentHTML(
  'beforeend',
  ModalShell({
    id: 'modal-dismissible',
    title: 'Modal dispensável',
    description: 'Esc, clique no fundo e o botão Fechar fecham este modal.',
    body: '<p>Conteúdo informativo, sem formulário.</p>',
    footer: Button({ label: 'Entendi', variant: 'primary', attributes: { 'data-modal-close': true } }),
    dismissible: true
  }) +
    ModalShell({
      id: 'modal-form',
      title: 'Editar ferramenta',
      description: 'Clique no fundo não fecha; Esc com alterações pede confirmação.',
      body: Input({ label: 'Nome da ferramenta', id: 'm-name', value: 'Furadeira' }),
      footer:
        Button({ label: 'Cancelar', variant: 'secondary', attributes: { 'data-modal-close': true } }) +
        Button({ label: 'Salvar', variant: 'primary', attributes: { 'data-modal-close': true } }),
      dismissible: false
    })
);

const result = document.getElementById('gallery-result');
const say = (text) => {
  result.textContent = text;
};

initModals();
bindFieldValidation();
notifications.init();

const open = (id) => document.getElementById(id).showModal();
const click = (id, fn) => document.getElementById(id).addEventListener('click', fn);

click('open-modal-dismissible', () => open('modal-dismissible'));
click('open-modal-form', () => open('modal-form'));
click('btn-loading', (event) => {
  const button = event.currentTarget;

  if (button.getAttribute('aria-busy') === 'true') {
    return;
  }

  setBusy(button, true);
  setTimeout(() => setBusy(button, false), 1500);
});
click('open-confirm', async () => {
  say(`resultado: ${await confirmDialog({ title: 'Salvar alterações?', description: 'As alterações serão aplicadas.', confirmLabel: 'Salvar' })}`);
});
click('open-confirm-danger', async () => {
  say(
    `resultado: ${await confirmDialog({
      title: 'Excluir definitivamente?',
      description: 'Esta ferramenta será removida.',
      warning: 'Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant: 'danger'
    })}`
  );
});
click('open-confirm-strong', async () => {
  say(
    `resultado: ${await confirmDialog({
      title: 'Apagar todos os registros?',
      description: 'Confirmação reforçada.',
      confirmLabel: 'Apagar',
      variant: 'danger',
      requireText: 'APAGAR'
    })}`
  );
});
click('open-confirm-fail', async () => {
  say(
    `resultado: ${await confirmDialog({
      title: 'Enviar?',
      description: 'A operação vai falhar.',
      confirmLabel: 'Enviar',
      onConfirm: () => new Promise((_, reject) => setTimeout(() => reject(new Error('Falha simulada.')), 300))
    })}`
  );
});

click('toast-success', () => notifications.success('Registro salvo com sucesso.'));
click('toast-error', () => notifications.error('Não foi possível salvar o registro. Tente novamente.'));
click('toast-warning', () => notifications.warning('Sessão expira em breve.'));
click('toast-info', () => notifications.info('Sincronização concluída.'));

const dropdown = new Dropdown({
  trigger: document.getElementById('dd-trigger'),
  panel: document.getElementById('dd-panel')
});

['dd-edit', 'dd-copy', 'dd-delete'].forEach((id) => click(id, () => say(`ação: ${id}`)));
window.__gallery = { dropdown, confirmDialog };
