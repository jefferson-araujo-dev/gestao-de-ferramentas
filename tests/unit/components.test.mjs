import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  IconButton,
  Input,
  ModalShell,
  STATUS_MAP,
  Search,
  Select,
  Skeleton,
  SkeletonCard,
  StatCard,
  StatusBadge,
  Switch,
  esc,
} from '../../src/js/components/index.js';
import { toastDuration, toastRole } from '../../src/js/components/toast-policy.js';

// Contratos dos componentes fundamentais (Gate 1-E) sem navegador: marcação, acessibilidade,
// escaping e política de Toast. O comportamento interativo é coberto em tests/e2e/components.spec.js.
const read = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

describe('esc', () => {
  test('escapa HTML e aspas; null/undefined viram vazio', () => {
    assert.equal(esc('<b a="1">&\'</b>'), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;');
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
  });
});

describe('Button', () => {
  test('variantes semânticas geram a classe do componente; padrão é secondary/button', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger']) {
      assert.match(Button({ label: 'X', variant }), new RegExp(`ui-btn--${variant}`));
    }

    const html = Button({ label: 'Salvar' });

    assert.match(html, /type="button"/);
    assert.match(html, /ui-btn--secondary/);
  });

  test('label é obrigatório e variante inválida reprova', () => {
    assert.throws(() => Button({}), /label/);
    assert.throws(() => Button({ label: 'X', variant: 'rosa' }), /Variante/);
  });

  test('texto é escapado; disabled, block, tamanho e ícone (decorativo)', () => {
    const html = Button({
      label: '<i>x</i>',
      disabled: true,
      block: true,
      size: 'sm',
      icon: 'icon-download',
    });

    assert.match(html, /&lt;i&gt;x&lt;\/i&gt;/);
    assert.match(html, / disabled/);
    assert.match(html, /ui-btn--block/);
    assert.match(html, /ui-btn--sm/);
    assert.match(html, /<svg[^>]*aria-hidden="true"/);
  });
});

describe('IconButton', () => {
  test('exige nome acessível e ícone', () => {
    assert.throws(() => IconButton({ icon: 'icon-close' }), /label/);
    assert.throws(() => IconButton({ label: '  ', icon: 'icon-close' }), /label/);
    assert.throws(() => IconButton({ label: 'Fechar' }), /icon/);
  });

  test('aria-label presente, ícone aria-hidden e sem texto visível', () => {
    const html = IconButton({ label: 'Fechar "janela"', icon: 'icon-close' });

    assert.match(html, /aria-label="Fechar &quot;janela&quot;"/);
    assert.match(html, /<svg[^>]*aria-hidden="true"/);
    assert.doesNotMatch(html, /<span/);
  });
});

describe('Input / Select / Search', () => {
  test('rótulo associado (label[for] = id) e placeholder não substitui o rótulo', () => {
    const html = Input({ label: 'Nome', id: 'f-nome', placeholder: 'João' });

    assert.match(html, /<label class="ui-label" for="f-nome">Nome<\/label>/);
    assert.match(html, /id="f-nome"/);
    assert.match(html, /placeholder="João"/);
  });

  test('sem rótulo reprova (Input, Select, Search, Checkbox, Switch)', () => {
    assert.throws(() => Input({}), /label/);
    assert.throws(() => Select({ options: [] }), /label/);
    assert.throws(() => Search({ label: '' }), /label/);
    assert.throws(() => Checkbox({}), /label/);
    assert.throws(() => Switch({}), /label/);
  });

  test('erro => aria-invalid, aria-describedby e mensagem visível; sem erro a mensagem fica oculta', () => {
    const withError = Input({ label: 'A', id: 'a', error: 'Obrigatório', help: 'Dica' });

    assert.match(withError, /aria-invalid="true"/);
    assert.match(withError, /aria-describedby="a-help a-error"/);
    assert.match(withError, /<p class="ui-error" id="a-error" >Obrigatório<\/p>/);

    const clean = Input({ label: 'A', id: 'a' });

    assert.doesNotMatch(clean, /aria-invalid/);
    assert.match(clean, /id="a-error" hidden/);
  });

  test('hideLabel mantém o rótulo no DOM, só visualmente oculto (nome acessível)', () => {
    const html = Select({
      label: 'Filtrar',
      id: 's',
      hideLabel: true,
      options: [{ value: 'a', label: 'A' }],
    });

    assert.match(html, /class="ui-label ui-sr-only" for="s"/);
    assert.match(html, /<option value="a">A<\/option>/);
  });

  test('Search: type=search dentro de landmark role=search, ícone decorativo', () => {
    const html = Search({ label: 'Buscar ferramentas', id: 'q' });

    assert.match(html, /role="search"/);
    assert.match(html, /type="search"/);
    assert.match(
      html,
      /class="ui-search__icon"[^>]*aria-hidden|aria-hidden="true"[^>]*ui-search__icon/
    );
  });

  test('valores são escapados', () => {
    assert.match(Input({ label: 'A', value: '"><script>' }), /value="&quot;&gt;&lt;script&gt;"/);
  });
});

describe('Checkbox / Switch', () => {
  test('checkbox: label associado, checked e disabled', () => {
    const html = Checkbox({ label: 'Aceito', id: 'c', checked: true, disabled: true });

    assert.match(html, /<label class="ui-check__label" for="c">Aceito<\/label>/);
    assert.match(html, / checked/);
    assert.match(html, / disabled/);
  });

  test('switch: input checkbox com role=switch, trilha decorativa e rótulo visível', () => {
    const html = Switch({ label: 'Agrupar', id: 'g', checked: true });

    assert.match(html, /type="checkbox" role="switch"/);
    assert.match(html, /ui-switch__track" aria-hidden="true"/);
    assert.match(html, /<label class="ui-switch__label" for="g">Agrupar<\/label>/);
  });
});

describe('Badge / StatusBadge', () => {
  test('todo status conhecido tem TEXTO (nunca só cor) e um tom semântico', () => {
    for (const [status, { label, tone }] of Object.entries(STATUS_MAP)) {
      const html = StatusBadge(status);

      assert.ok(label.length > 0);
      assert.match(html, new RegExp(`>${label}</span>$`));
      assert.match(html, new RegExp(`ui-badge--${tone}`));
      assert.match(html, /ui-badge__dot" aria-hidden="true"/);
    }
  });

  test('compatível com o antigo getBadgeHTML: mesmos rótulos', () => {
    assert.match(StatusBadge('available'), /Disponível/);
    assert.match(StatusBadge('borrowed'), /Emprestada/);
    assert.match(StatusBadge('maintenance'), /Manutenção/);
    assert.match(StatusBadge('in'), /Devolução/);
    assert.match(StatusBadge('out'), /Retirada/);
  });

  test('status desconhecido: neutro, com o texto escapado', () => {
    const html = StatusBadge('x <b>');

    assert.match(html, /ui-badge--neutral/);
    assert.match(html, /x &lt;b&gt;/);
    assert.doesNotMatch(html, /<b>/);
  });

  test('Badge valida tom e exige label', () => {
    assert.throws(() => Badge({ label: 'x', tone: 'roxo' }), /Tom/);
    assert.throws(() => Badge({}), /label/);
    assert.match(Badge({ label: 'ok', tone: 'success' }), /ui-badge--success/);
  });
});

describe('Card / StatCard', () => {
  test('StatCard: valor tabular, rótulo, meta opcional e id do valor preservado', () => {
    const html = StatCard({
      label: 'Total',
      value: '8',
      valueId: 'stat-total',
      meta: 'Atualizado hoje',
    });

    assert.match(html, /class="ui-stat__value stat-number" id="stat-total">8</);
    assert.match(html, /ui-stat__label">Total</);
    assert.match(html, /Atualizado hoje/);
  });

  test('interativo vira <button type=button>; não interativo é <div>', () => {
    assert.match(StatCard({ label: 'A', interactive: true }), /^<button type="button"/);
    assert.match(StatCard({ label: 'A' }), /^<div/);
  });

  test('ícone é decorativo e o texto é escapado', () => {
    const html = StatCard({ label: '<x>', icon: 'icon-inventory' });

    assert.match(html, /ui-stat__icon" aria-hidden="true"/);
    assert.match(html, /&lt;x&gt;/);
  });

  test('Card compõe header/body/footer', () => {
    const html = Card({ header: 'H', body: 'B', footer: 'F' });

    assert.match(html, /ui-card__header">H</);
    assert.match(html, /ui-card__body">B</);
    assert.match(html, /ui-card__footer">F</);
  });
});

describe('Alert / EmptyState / Skeleton', () => {
  test('Alert: warning/danger assertivos (alert), info/success educados (status); ícone + texto', () => {
    assert.match(Alert({ tone: 'danger', message: 'x' }), /role="alert"/);
    assert.match(Alert({ tone: 'warning', message: 'x' }), /role="alert"/);
    assert.match(Alert({ tone: 'info', message: 'x' }), /role="status"/);
    assert.match(Alert({ tone: 'success', title: 'Ok' }), /role="status"/);
    assert.match(Alert({ tone: 'info', message: 'x' }), /ui-alert__icon/);
    assert.throws(() => Alert({ tone: 'info' }), /title/);
  });

  test('EmptyState: título obrigatório; descrição e ação opcionais', () => {
    assert.throws(() => EmptyState({}), /title/);

    const html = EmptyState({
      title: 'Nada aqui',
      description: 'Tente de novo',
      action: '<button>ok</button>',
    });

    assert.match(html, /ui-empty__title">Nada aqui</);
    assert.match(html, /ui-empty__description">Tente de novo</);
    assert.match(html, /ui-empty__action"><button>ok<\/button>/);
    assert.doesNotMatch(EmptyState({ title: 'x' }), /ui-empty__description|ui-empty__action/);
  });

  test('Skeleton é decorativo (aria-hidden) com dimensões explícitas', () => {
    assert.match(Skeleton({ width: '50%', height: '2rem' }), /aria-hidden="true"/);
    assert.match(Skeleton({ width: '50%', height: '2rem' }), /width:50%;height:2rem/);
    assert.match(SkeletonCard(), /aria-hidden="true"/);
  });
});

describe('ModalShell', () => {
  test('título associado, descrição, política de fechamento e botão Fechar nomeado', () => {
    const html = ModalShell({
      id: 'm',
      title: 'Editar',
      description: 'Detalhe',
      dismissible: false,
    });

    assert.match(html, /aria-labelledby="m-title"/);
    assert.match(html, /aria-describedby="m-desc"/);
    assert.match(html, /data-dismissible="false"/);
    assert.match(html, /aria-label="Fechar"/);
    assert.throws(() => ModalShell({ id: 'm' }), /title/);
  });

  test('dismissible é true por padrão', () => {
    assert.match(ModalShell({ id: 'm', title: 'T' }), /data-dismissible="true"/);
  });
});

describe('política do Toast', () => {
  test('erros e avisos nunca somem depressa: mínimos e leitura proporcional', () => {
    assert.ok(toastDuration('error', 'Falhou') >= 12000);
    assert.ok(toastDuration('warning', 'Atenção') >= 8000);
    assert.ok(toastDuration('success', 'Salvo') >= 4000);
    assert.ok(toastDuration('info', 'Aviso') >= 5000);
    assert.ok(toastDuration('error', 'Falhou') > toastDuration('success', 'Salvo'));
  });

  test('mensagem longa ganha tempo de leitura (com teto)', () => {
    const long = Array(60).fill('palavra').join(' ');

    assert.ok(toastDuration('success', long) > toastDuration('success', 'curta'));
    assert.ok(toastDuration('success', Array(400).fill('p').join(' ')) <= 20000);
  });

  test('persistent/Infinity/progress exigem fechar manualmente', () => {
    assert.equal(toastDuration('warning', 'x', { persistent: true }), Infinity);
    assert.equal(toastDuration('info', 'x', { duration: Infinity }), Infinity);
    assert.equal(toastDuration('progress', 'x'), Infinity);
  });

  test('duração pedida pelo chamador nunca fica abaixo do mínimo de erro/aviso', () => {
    assert.ok(toastDuration('error', 'x', { duration: 500 }) >= 12000);
    assert.ok(toastDuration('warning', 'x', { duration: 500 }) >= 8000);
    assert.equal(toastDuration('success', 'x', { duration: 6000 }), 6000);
  });

  test('erro/aviso => role=alert (assertivo); sucesso/info => role=status (educado)', () => {
    assert.equal(toastRole('error'), 'alert');
    assert.equal(toastRole('warning'), 'alert');
    assert.equal(toastRole('success'), 'status');
    assert.equal(toastRole('info'), 'status');
  });
});

describe('contratos do CSS dos componentes', () => {
  const css = read('css/components.css');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  test('sem !important, sem cor fixa (hex/rgb) fora de token e sem variante dark: do Tailwind', () => {
    assert.doesNotMatch(stripped, /!important/);
    assert.doesNotMatch(stripped, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(stripped, /dark:/);
  });

  test('rgb() só nos backdrops (preto translúcido), nunca em cor de componente', () => {
    const uses = [...stripped.matchAll(/rgb\(([^)]*)\)/g)].map((m) => m[1]);

    assert.ok(uses.every((value) => value.startsWith('0 0 0 /')));
  });

  test('media queries só usam o contrato de breakpoints (768) e o complemento 767.98', () => {
    const widths = [...stripped.matchAll(/@media\s*\(\s*(min|max)-width:\s*([\d.]+)px\s*\)/g)].map(
      (m) => `${m[1]}:${m[2]}`
    );

    assert.ok(widths.length > 0);
    assert.ok(
      widths.every((w) => ['min:768', 'max:767.98'].includes(w)),
      widths.join(', ')
    );
  });

  test('toda classe ui-* usada nos renderizadores existe no CSS', () => {
    const emitted = new Set(
      [
        Button({ label: 'x', icon: 'icon-x', block: true, size: 'sm' }),
        IconButton({ label: 'x', icon: 'icon-x' }),
        Input({ label: 'x', help: 'h', error: 'e', required: true }),
        Select({ label: 'x', options: [] }),
        Search({ label: 'x' }),
        Checkbox({ label: 'x', help: 'h' }),
        Switch({ label: 'x' }),
        Badge({ label: 'x' }),
        StatusBadge('available'),
        Card({ header: 'h', footer: 'f' }),
        StatCard({ label: 'x', icon: 'icon-x', meta: 'm', metaIcon: 'icon-x', interactive: true }),
        Alert({ tone: 'info', title: 't', message: 'm' }),
        EmptyState({ title: 't', description: 'd', action: 'a' }),
        SkeletonCard(),
        ModalShell({ id: 'm', title: 't', description: 'd', footer: 'f' }),
      ]
        .join(' ')
        .match(/\bui-[a-z0-9_-]+/g)
    );

    for (const name of emitted) {
      assert.ok(css.includes(`.${name}`), `classe sem CSS: .${name}`);
    }
  });

  test('reduced-motion: skeleton e indicador de loading ficam sem animação', () => {
    assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*\.ui-skeleton[\s\S]*animation: none/);
  });
});
