import process from 'node:process';

import { defineConfig, presetWind4, transformerDirectives, transformerVariantGroup } from 'unocss';

import { presetA11y } from './uno-preset-a11y.js';
import { presetRtl } from './uno-preset-rtl.js';
import { theme } from './uno.theme.js';

export default defineConfig({
  content: {
    pipeline: {
      exclude: [/\.(css|postcss|sass|scss|less|stylus|styl)($|\?)/, /\?macro=true/],
      include: [/\.(vue|html)($|\?)/],
    },
  },
  presets: [
    presetWind4(),
    // Dev-time checkers that warn on physical direction and hardcoded pixel text sizes.
    // Keep these presets last.
    ...(process.env.CI ? [] : [presetRtl(), presetA11y()]),
  ],
  transformers: [transformerDirectives({ enforce: 'pre' }), transformerVariantGroup()],
  theme,
  shortcuts: [
    // Layout
    ['panel', 'border border-line bg-panel'],
    [
      'section-title',
      'h-11 flex items-center justify-between border-b border-line px-3.5 font-650',
    ],

    // Typography
    ['mono', 'font-mono text-xs'],
    ['label-upper', 'text-4xs text-muted font-700 tracking-wider uppercase'],

    // Focus states - subtle but accessible
    [
      'focus-ring',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
    ],

    // Controls
    [
      'btn',
      'focus-ring h-9 flex items-center justify-center border text-xs text-ink font-650 transition disabled:cursor-wait disabled:opacity-60',
    ],
    ['btn-subtle', 'btn border-line bg-raised hover:border-muted'],
    ['btn-accent', 'btn border-accent/45 bg-accent/8 hover:border-accent'],
    [
      'btn-icon',
      'focus-ring h-9 w-9 grid place-items-center border border-line bg-raised text-ink transition hover:border-muted',
    ],
    ['btn-link', 'focus-ring text-xs text-link'],
    ['input-field', 'focus-ring h-9 border border-line bg-raised px-2.5 text-xs text-ink'],
  ],
});
