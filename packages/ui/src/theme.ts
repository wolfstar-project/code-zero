import type { Theme } from '@unocss/preset-wind4/theme';

/**
 * Brand theme resolved from the CSS custom properties in `tokens.css`, so a colour lives in one
 * place and both colour schemes switch with `data-theme` alone.
 */
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

/**
 * Fluid display steps for pages that render a headline. An operations console never does, so the
 * marketing site opts in and the dashboard does not.
 */
export const displayText = {
  display: { fontSize: 'clamp(2.5rem, 1.6rem + 4vw, 4.5rem)', lineHeight: '1.04' },
  headline: { fontSize: 'clamp(1.875rem, 1.35rem + 2.2vw, 3rem)', lineHeight: '1.12' },
} satisfies Theme['text'];
