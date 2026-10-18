# Code Zero design contract

Every rule here can reject a change. If a change needs to break one, change this file in the same
pull request and say why.

## Source of truth

- Colours, focus, selection and scrollbars live in `tokens.css`. Apps import it and never restate a
  `--cz-*` value.
- UnoCSS theme names (`canvas`, `panel`, `raised`, `line`, `ink`, `muted`, `accent`, `warning`,
  `danger`, `link`) are the only colour utilities. No hex, `rgb()` or named colours in templates.
- Both colour schemes come from `data-theme`. A component never branches on the scheme.

## Shape and depth

- Corners are square. `rounded-full` is allowed only for status dots and avatars.
- No drop shadows and no decorative gradients. Depth comes from `canvas` → `panel` → `raised` and a
  `line` border. The page grid (`--cz-grid`) and the marketing hero halo are the only gradients.

## Type

- Sans is Geist with Inter fallback; numbers, ids, paths and commands use Geist Mono (`mono`).
- No pixel font sizes in templates; use the scale (`text-4xs` … `text-lg`, `display`, `headline`).
  The a11y preset warns on violations in development.
- Uppercase is for small labels only (`label-upper`, `eyebrow`), never for sentences or buttons.

## Density

- The dashboard is dense: 36 px controls (`h-9`), `text-xs` body in panels.
- The marketing site is comfortable: 44 px controls (`h-11`), `text-sm` and up. Its primary
  actions use solid `accent` with `canvas` text; secondary actions keep bordered surfaces.
- Shared shortcuts (`panel`, `mono`, `focus-ring`, `btn-subtle`, `btn-accent`, `btn-icon`,
  `input-field`) come from `defineCodeZeroUno`; apps may override control shortcuts for their density and primary-action treatment.

## Interaction and accessibility

- Every focusable element shows `focus-ring` or the global `:focus-visible` outline.
- Logical properties only (`ms-*`, `pe-*`, `start-*`); the RTL preset warns on physical ones.
- Motion respects `prefers-reduced-motion`; contrast respects `prefers-contrast: more`. Both are
  handled in `tokens.css` and must not be overridden per component.
- Form controls render at 16 px on narrow screens so iOS does not zoom.
