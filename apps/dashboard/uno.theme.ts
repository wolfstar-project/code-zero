import type { Theme } from '@unocss/preset-wind4/theme';

export const theme = {
  font: {
    mono: "'Geist Mono', ui-monospace, SFMono-Regular, Consolas, monospace",
    sans: "'Geist', Inter, ui-sans-serif, system-ui, sans-serif",
  },
  text: {
    '3xs': { fontSize: '0.625rem' },
    '4xs': { fontSize: '0.5625rem' },
  },
  colors: {
    canvas: 'var(--cz-canvas)',
    panel: 'var(--cz-panel)',
    raised: 'var(--cz-raised)',
    line: 'var(--cz-line)',
    ink: 'var(--cz-ink)',
    muted: 'var(--cz-muted)',
    accent: 'var(--cz-accent)',
    warning: 'var(--cz-warning)',
    danger: 'var(--cz-danger)',
    link: 'var(--cz-link)',
  },
} satisfies Theme;
