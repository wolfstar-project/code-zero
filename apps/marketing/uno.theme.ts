import type { Theme } from '@unocss/preset-wind4/theme';

/**
 * Same brand tokens the dashboard ships, resolved from the CSS custom properties in
 * `app/assets/css/main.css`. The marketing site adds display-scale type steps the dashboard has
 * no use for: an operations console never renders a headline.
 */
export const theme = {
  font: {
    mono: "'Geist Mono', ui-monospace, SFMono-Regular, Consolas, monospace",
    sans: "'Geist', Inter, ui-sans-serif, system-ui, sans-serif",
  },
  text: {
    '3xs': { fontSize: '0.625rem' },
    '4xs': { fontSize: '0.5625rem' },
    // Fluid display steps so the hero does not need a breakpoint ladder.
    display: { fontSize: 'clamp(2.5rem, 1.6rem + 4vw, 4.5rem)', lineHeight: '1.04' },
    headline: { fontSize: 'clamp(1.875rem, 1.35rem + 2.2vw, 3rem)', lineHeight: '1.12' },
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
