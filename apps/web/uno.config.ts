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
    ['btn-link', 'focus-ring text-xs text-link'],
  ],
});
