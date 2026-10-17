import process from 'node:process';

import type { Theme } from '@unocss/preset-wind4/theme';
import {
  defineConfig,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
  type UserConfig,
  type UserShortcuts,
} from 'unocss';

import { presetA11y } from './presets/a11y.js';
import { presetRtl } from './presets/rtl.js';
import { theme as baseTheme } from './theme.js';

// Only templates carry utility classes; stylesheets and Nuxt's macro queries never do.
const STYLESHEET = /\.(css|postcss|sass|scss|less|stylus|styl)($|\?)/;
const MACRO_QUERY = /\?macro=true/;
const TEMPLATE = /\.(vue|html)($|\?)/;

/** Shortcuts every app shares. Density-dependent controls (`btn`, layout) stay in each app. */
export const baseShortcuts = [
  ['panel', 'border border-line bg-panel'],
  ['mono', 'font-mono text-xs'],
  [
    'focus-ring',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
  ],
  ['btn-subtle', 'btn border-line bg-raised hover:border-muted'],
  ['btn-accent', 'btn border-accent/45 bg-accent/8 hover:border-accent'],
  [
    'btn-icon',
    'focus-ring h-9 w-9 grid place-items-center border border-line bg-raised text-ink transition hover:border-muted',
  ],
  ['input-field', 'focus-ring h-9 border border-line bg-raised px-2.5 text-xs text-ink'],
] satisfies ShortcutList;

/** The array form of UnoCSS shortcuts, the only form that can be appended to the shared ones. */
export type ShortcutList = Extract<UserShortcuts<Theme>, unknown[]>;

export interface CodeZeroUnoOptions {
  /** App-specific shortcuts, applied after `baseShortcuts` so an app can refine a shared name. */
  readonly shortcuts?: ShortcutList;
  /** Extra text steps merged into the base theme (for example `displayText`). */
  readonly text?: Theme['text'];
  /**
   * Whether the dev-time RTL and accessibility checkers run. They only warn, so CI turns them off
   * to keep logs readable; the default follows `CI`.
   */
  readonly checkers?: boolean;
}

/** The UnoCSS configuration every Code Zero app starts from. */
export function defineCodeZeroUno(options: CodeZeroUnoOptions = {}): UserConfig<Theme> {
  const checkers = options.checkers ?? !process.env.CI;
  return defineConfig<Theme>({
    content: {
      pipeline: {
        exclude: [STYLESHEET, MACRO_QUERY],
        include: [TEMPLATE],
      },
    },
    presets: [
      presetWind4(),
      // Dev-time checkers that warn on physical direction and hardcoded pixel text sizes. Kept
      // last so they see every rule the other presets produce.
      ...(checkers ? [presetRtl(), presetA11y()] : []),
    ],
    transformers: [transformerDirectives({ enforce: 'pre' }), transformerVariantGroup()],
    theme: { ...baseTheme, text: { ...baseTheme.text, ...options.text } },
    shortcuts: [...baseShortcuts, ...(options.shortcuts ?? [])],
  });
}
