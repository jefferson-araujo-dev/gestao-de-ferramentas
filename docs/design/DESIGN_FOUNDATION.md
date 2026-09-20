# Fundação de design (Gate 1-C)

Base visual do redesign: tokens semânticos, tipografia, foco, movimento e primitives CSS.
Este documento não descreve telas novas; descreve a fundação que os próximos gates consomem.

## Onde vivem os tokens (fonte única)

| Arquivo | Conteúdo |
| --- | --- |
| `src/css/tokens.css` | Tokens de cor (LIGHT em `@theme static`, DARK em `.dark`), escala tipográfica, raio, sombra, espaçamento e movimento |
| `src/css/base.css` | `:focus-visible`, `prefers-reduced-motion`, números tabulares |
| `src/css/main.css` | Importa os dois acima logo após `@import 'tailwindcss'`; camada legada (ver abaixo) |

Não existe `tailwind.config.js`: o Tailwind v4 lê `@theme` direto do CSS. Nenhuma biblioteca de
design system foi adicionada.

### Como as classes consomem os tokens

Cada `--color-<nome>` gera utilitários e pode ser lido com `var(--color-<nome>)`:

```html
<div class="bg-surface border border-border text-text-primary rounded-ui-md shadow-ui-sm">
  <p class="text-body text-text-secondary">Texto de apoio</p>
  <input class="bg-surface border border-border-control" />
</div>
```

### Como `.dark` redefine o conjunto

`.dark` (no `<html>`, definido pelo script anti-flash do `index.html` e por `localStorage`) está
fora de qualquer camada CSS e por isso vence o `:root` da camada `theme` do Tailwind. Ele
redefine exatamente o mesmo conjunto de variáveis: um componente escrito com tokens troca de
tema sem variante `dark:`. Um teste (`tests/unit/designTokens.test.mjs`) reprova se LIGHT e DARK
divergirem em conjunto de tokens. O seletor de 3 estados (claro/escuro/sistema) **não** foi
implementado: fica para gate posterior.

## Tokens de cor

Exigidos pelo gate: `background`, `surface`, `surface-elevated`, `surface-muted`, `border`,
`border-control`, `text-primary`, `text-secondary`, `text-muted`, `text-inverse`, `accent`,
`accent-hover`, `accent-active`, `success`, `warning`, `danger`, `info`, `focus-ring`.

| Token | LIGHT | DARK |
| --- | --- | --- |
| background | `#f8fafc` | `#020617` |
| surface | `#ffffff` | `#0f172a` |
| surface-elevated | `#ffffff` | `#1e293b` |
| surface-muted | `#f1f5f9` | `#162032` |
| border | `#e2e8f0` | `#334155` |
| border-control | `#748296` | `#748296` |
| text-primary | `#0f172a` (slate-900) | `#f1f5f9` (slate-100) |
| text-secondary | `#475569` (slate-600) | `#cbd5e1` (slate-300) |
| text-muted | `#64748b` (slate-500) | `#94a3b8` (slate-400) |
| text-inverse | `#ffffff` | `#0f172a` |
| accent / hover / active | `#1d4ed8` / `#1e40af` / `#1e3a8a` | `#2563eb` / `#1d4ed8` / `#1e40af` |
| success | `#047857` | `#34d399` |
| warning | `#b45309` | `#fbbf24` |
| danger | `#be123c` | `#fb7185` |
| info | `#0e7490` | `#22d3ee` |
| focus-ring | `#1d4ed8` | `#93c5fd` |

**Accent.** O azul atual (`brand-600`, `#1d4ed8`) é o único accent principal. No dark o
preenchimento sobe para `#2563eb` (mesmo matiz) para não se perder sobre superfícies escuras.
`success/warning/danger/info` são semânticos e não são azuis; `info` é ciano, distinto do accent
(o teste confere matiz).

### Tokens derivados (acréscimo justificado)

Não estavam na lista do gate, mas são necessários para cumprir o contraste no dark, onde uma
única cor não serve ao mesmo tempo de preenchimento (texto branco sobre ela) e de texto sobre a
superfície escura:

- `on-accent` (`#ffffff` nos dois temas): texto sobre `accent*`.
- `accent-text` (`#1d4ed8` / `#93c5fd`): azul legível como texto/ícone/link sobre superfícies.
- `accent-subtle` (`#eff6ff` / `#172554`): fundo de estado selecionado.
- `success|warning|danger|info-subtle`: fundos suaves de alerta/badge. Os tokens de estado são
  cor de texto/ícone/indicador (>= 4.5:1 sobre as superfícies e sobre o próprio `-subtle`).
  Preenchimento sólido com texto branco não é garantido no dark; usar `-subtle` + cor do estado.

## Contraste

Piso: texto normal WCAG AA (>= 4.5:1); `border-control` e `focus-ring` >= 3:1 contra as
superfícies. Tudo é verificado automaticamente por `tests/unit/designTokens.test.mjs` para os
dois temas (texto x 4 superfícies, on-accent x accent, accent-text, estados x superfícies e
`-subtle`, border-control, focus-ring).

**Exceção documentada (única):** LIGHT `text-muted` (slate-500, referência do Gate 1-A) sobre
`surface-muted` (`#f1f5f9`) mede 4,34:1, abaixo de AA. Sobre `background`, `surface` e
`surface-elevated` passa (4,55 a 4,76). Regra: em `surface-muted` use `text-secondary`. O teste
trava a lista de exceções em exatamente esse par. Não use slate-400 (`#94a3b8`) sobre branco
para texto informativo (2,56:1); no DARK ele é o `text-muted` (>= 5,7:1 sobre as superfícies).

`border-control` (`#748296`) é o mesmo nos dois temas: 3,57 a 3,91:1 no claro e 3,74 a 5,16:1 no
escuro. `border` (decorativo) não tem exigência de 3:1.

## Tipografia

Utilitários gerados por `@theme`: tamanho/altura de linha/peso num só utilitário.

| Utilitário | Tamanho/linha | Peso |
| --- | --- | --- |
| `text-display` | 30/36 | bold (700) |
| `text-heading-lg` | 24/32 | semibold (600) |
| `text-heading-md` | 20/28 | semibold (600) |
| `text-body` | 14/20 | herdado |
| `text-label` | 12/16 | medium (500) |
| `text-caption` | 12/16 | herdado |

`label` e `caption` têm o mesmo tamanho pedido no gate; o peso 500 distingue o rótulo.
`--font-sans` mantém a pilha anterior (`Inter, sans-serif`, fallback idêntico). KPIs:
`.stat-number` usa `tabular-nums` (utilitário `tabular-nums` do Tailwind para novos casos).
Monoespaçada só para códigos técnicos (`font-mono`; `code/kbd/samp` já herdam do preflight).

**Inputs em mobile (16px):** a regra existente `@supports (-webkit-touch-callout: none)` no
`main.css` (iOS/WebKit) continua sendo a cobertura e **não foi alterada**: só WebKit dá zoom
automático e ela não é verificável no Chromium usado nos testes. Ver "Legado".

## Espaçamento, raio, sombra, movimento

- **Espaçamento:** 4 8 12 16 24 32 48 64 px = passos 1 2 3 4 6 8 12 16 da escala padrão do
  Tailwind (`p-1` ... `p-16`), que segue sendo a via preferencial no markup. As variáveis
  `--space-*` existem para CSS customizado.
- **Raio:** `--radius-ui-sm/md/lg/full` = 6/8/12/9999px (`rounded-ui-*`). O namespace `ui` é
  deliberado: sobrescrever `rounded-sm/md/lg` do Tailwind alteraria ~200 usos existentes de uma vez.
  A migração dos usos existentes é do gate de componentes.
- **Sombra:** `--shadow-ui-sm/md/lg` (`shadow-ui-*`), sempre preto com alpha, sem cor. No DARK ficam
  mais opacas só o suficiente para reforçar; a separação vem de `surface` + `border`. Mesma razão
  de namespace: `shadow-sm/md/lg` do Tailwind não foram tocados.
- **Movimento:** `--motion-duration-fast/base/slow` (150/200/300ms) e `--motion-ease-standard`
  espelham valores já usados pelo app. Nenhuma das 96 ocorrências de `transition-all` foi refatorada.

## Foco visível

`base.css` define `:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px }`
(offset 0 em `input/select/textarea`). Está fora de camada de propósito: vence utilitários como
`outline-none` e `focus:ring-*` sem migrar tela a tela, então o ring de baixa opacidade deixa de ser
o único indicador. Usa `outline` (não `box-shadow`) para continuar visível em alto contraste.
Do `.btn` foram removidos `focus:outline-none focus:ring-2 focus:ring-brand-500/20`.

## Movimento reduzido

`@media (prefers-reduced-motion: reduce)` em `base.css` reduz `animation-duration`,
`transition-duration` e `scroll-behavior` (com `!important`, exceção intencional e única). O
`ResponsiveManager` ainda injeta uma regra equivalente em runtime; ela ficou como está (fora do
escopo de JS deste gate) e é redundante, não conflitante.

## Breakpoints: auditoria (NÃO unificados)

Alvo: mobile < 768, tablet 768-1023, notebook 1024-1279, desktop >= 1280. O alvo coincide com
`md`/`lg`/`xl` do Tailwind (768/1024/1280), portanto o markup Tailwind já o respeita.
Três sistemas independentes seguem divergindo:

| Sistema | Valores | Onde |
| --- | --- | --- |
| Tailwind v4 (classes) | sm 640, md 768, lg 1024, xl 1280, 2xl 1536 | ~325 usos de `sm:/md:/lg:/xl:` em html/js |
| CSS legado (`@media`) | 374, 375-479, 480-767, 768-1023, 1024-1535, 1536 (+ 1280 no wrapper) | `main.css` |
| JS `ResponsiveManager` | xs 375, sm 480, md 768, lg 1024, **xl 1536** | `ResponsiveManager.js`; `ui.js` fixa 1024 |

Divergências: 375/480 (CSS e JS, ausentes do alvo), 1536 (`xl` do JS e do CSS = 2xl do Tailwind;
o alvo de "desktop" é 1280) e 640 (Tailwind `sm`). Unificar exige alterar `ResponsiveManager`, `ui.js`
e a lógica de layout do shell/sidebar, o que é mudança funcional. **Adiado** para o gate de
shell/responsividade. Nenhuma alegação de unificação é feita aqui.

## Legado CSS (mapa e o que mudou)

`main.css` antes -> depois: `!important` 63 -> 57; cores hex 59 -> 47; seletores por atributo
`[class*=` 44 -> 40. `base.css` acrescenta 4 declarações `!important` (movimento reduzido).

Removido, com prova de equivalência: no estado base dos filtros/ordenação
(`#quick-filters .quick-filter-btn`, `.sort-btn`, ...) e dos `.btn[class*='bg-*-600']`, os blocos
`.dark ...` duplicados e os hex `#fff/#e2e8f0/#475569/#0f172a/#334155/#cbd5e1` viraram
`var(--color-surface|border|text-secondary)`, que valem exatamente os mesmos valores nos dois
temas (`tests/e2e/foundation.spec.js` compara os valores computados, no claro e no escuro).
Migrados para token no `index.html`: cor de texto do `body` e fundo de `#main-content-scroll`
(diferença medida <= 1/255 no canal azul contra o slate `oklch` do Tailwind v4).

Mapeado e **mantido** (fora do escopo deste gate): `!important` restantes (estados hover/active da
camada de sobriedade, sobreposições da sidebar, regra iOS de 16px, `print`), seletores por atributo
`[class*='bg-*']`, regras globais `button/table/td/th` dentro de `@media`, hex dos estados
hover/active, `pulse-border` e scrollbar. Cada um exige prova própria e pertence ao gate dos
componentes.
