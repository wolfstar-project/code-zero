import { defineCodeZeroUno, displayText } from '@code-zero/ui';

// The marketing site is read at arm's length rather than scanned, so its rhythm is wider and
// softer than the dashboard's dense operational panels, and it opts into the display type steps.
export default defineCodeZeroUno({
  text: displayText,
  shortcuts: [
    ['shell', 'mx-auto w-full max-w-6xl px-5 sm:px-8'],
    ['section-y', 'py-16 sm:py-24'],
    ['card', 'panel p-6 transition hover:border-muted'],
    ['eyebrow', 'text-3xs text-accent font-700 tracking-[0.18em] uppercase'],
    ['lede', 'text-base text-muted leading-relaxed sm:text-lg'],
    [
      'btn',
      'focus-ring h-11 inline-flex items-center justify-center gap-2 border px-5 text-sm text-ink font-650 transition disabled:cursor-not-allowed disabled:opacity-60',
    ],
    ['btn-accent', 'btn border-accent bg-accent text-canvas hover:opacity-90'],
    [
      'btn-icon',
      'focus-ring h-11 w-11 grid shrink-0 place-items-center border border-line bg-raised text-ink transition hover:border-muted',
    ],
    ['input-field', 'focus-ring h-11 border border-line bg-raised px-3 text-sm text-ink'],
    ['btn-link', 'focus-ring text-sm text-link'],
  ],
});
