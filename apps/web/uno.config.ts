import { defineCodeZeroUno } from '@code-zero/ui';

// The console is dense: 36 px controls and `text-xs` panels. Colours, focus, the shared control
// shortcuts and the dev-time checkers come from `@code-zero/ui` (see its DESIGN.md).
export default defineCodeZeroUno({
  shortcuts: [
    [
      'section-title',
      'h-11 flex items-center justify-between border-b border-line px-3.5 font-650',
    ],
    ['label-upper', 'text-4xs text-muted font-700 tracking-wider uppercase'],
    [
      'btn',
      'focus-ring h-9 flex items-center justify-center border text-xs text-ink font-650 transition disabled:cursor-wait disabled:opacity-60',
    ],
    // The one solid control on a screen: queue a task, approve a run. Same treatment as the
    // marketing site's primary action, at the console's density.
    ['btn-primary', 'btn border-accent bg-accent text-canvas hover:bg-accent/88'],
    ['btn-link', 'focus-ring text-xs text-link'],
    // A small, square tag for a value that is one of a few: a mode, a source, an edition.
    [
      'chip',
      'h-6 inline-flex items-center gap-1.5 border border-line bg-raised px-2 text-3xs text-ink font-650',
    ],
  ],
});
