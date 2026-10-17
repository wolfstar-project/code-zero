// Ported from npmx.dev (https://github.com/npmx-dev/npmx.dev, MIT license).
import type { Theme } from '@unocss/preset-wind4/theme';
import { cornerMap, directionSize, h } from '@unocss/preset-wind4/utils';
import type { CSSEntries, DynamicMatcher, Preset, RuleContext } from 'unocss';

// Rule matchers, compiled once at module load rather than per preset instance.
const FORCE_PADDING_X = /^force-p([rl])-(.+)?$/;
const FORCE_MARGIN_X = /^force-m([rl])-(.+)?$/;
const FORCE_INSET_X = /^force-(?:position-|pos-)?(left|right)-(.+)$/;
const FORCE_TEXT_ALIGN = /^force-text-(left|right)$/;
const FORCE_ROUNDED_X = /^force-rounded-([rl])(?:-(.+))?$/;
const FORCE_BORDER_X = /^force-border-([rl])(?:-(.+))?$/;
const PADDING_X = /^p([rl])-(.+)?$/;
const MARGIN_X = /^m([rl])-(.+)?$/;
const INSET_X = /^(?:position-|pos-)?(left|right)-(.+)$/;
const RTL_MARKER = /^x-rtl-(start|end)$/;
const ROUNDED_X = /^rounded-([rl])(?:-(.+))?$/;
const BORDER_X = /^border-([rl])(?:-(.+))?$/;

type CollectorChecker = (warning: string, rule: string) => void;

// Track warnings to avoid duplicates
const warnedClasses = new Set<string>();

function warnOnce(message: string, key: string) {
  if (!warnedClasses.has(key)) {
    warnedClasses.add(key);
    // oxlint-disable-next-line no-console -- warn logging
    console.warn(message);
  }
}

function reportWarning(match: string, suggestedClass: string, checker?: CollectorChecker) {
  const message = `${checker ? 'a' : 'A'}void using '${match}', use '${suggestedClass}' instead, or 'force-${match}' to keep physical direction.`;
  if (checker) {
    checker(message, match);
  } else {
    warnOnce(`[RTL] ${message}`, match);
  }
}

const directionMap: Record<string, string[]> = {
  l: ['-left'],
  r: ['-right'],
  t: ['-top'],
  b: ['-bottom'],
  s: ['-inline-start'],
  e: ['-inline-end'],
  x: ['-left', '-right'],
  y: ['-top', '-bottom'],
  '': [''],
  bs: ['-block-start'],
  be: ['-block-end'],
  is: ['-inline-start'],
  ie: ['-inline-end'],
  block: ['-block-start', '-block-end'],
  inline: ['-inline-start', '-inline-end'],
};

function directionSizeRTL(
  propertyPrefix: string,
  prefixMap?: { l: string; r: string },
  checker?: CollectorChecker,
): DynamicMatcher<Theme> {
  const matcher = directionSize(propertyPrefix);
  return ([match = '', direction = '', size], context) => {
    if (!size) return undefined;
    const defaultMap = { l: 'is', r: 'ie' };
    const map = prefixMap || defaultMap;
    const replacement = direction === 'l' ? map.l : direction === 'r' ? map.r : undefined;
    if (!replacement) return undefined;

    const fullClass = context.rawSelector || match;
    const prefix = match.substring(0, 1); // 'p' or 'm'
    const suggestedBase = match.replace(`${prefix}${direction}`, `${prefix}${replacement}`);
    const suggestedClass = fullClass.replace(match, suggestedBase);

    reportWarning(fullClass, suggestedClass, checker);

    return matcher([match, replacement, size], context);
  };
}

function handlerRounded(
  [, a = '', s = 'DEFAULT']: string[],
  { theme }: RuleContext<Theme>,
): CSSEntries | undefined {
  const corners = cornerMap[a];
  if (!corners) return undefined;

  if (s === 'full') return corners.map((i) => [`border${i}-radius`, 'calc(infinity * 1px)']);

  const radius = theme.radius?.[s] ?? h.bracket?.cssvar?.global?.fraction?.rem?.(s);
  if (radius != null) {
    return corners.map((i) => [`border${i}-radius`, radius]);
  }
  return undefined;
}

function handlerBorderSize([, a = '', b = '1']: string[]): CSSEntries | undefined {
  const v = h.bracket?.cssvar?.global?.px?.(b);
  const directions = directionMap[a];
  if (directions && v != null) return directions.map((i) => [`border${i}-width`, v]);
  return undefined;
}

function handlerForceDirectionSize(
  propertyPrefix: string,
  [, direction, size]: string[],
  { theme }: RuleContext<Theme>,
): CSSEntries | undefined {
  const v =
    theme.spacing?.[size || 'DEFAULT'] ?? h.bracket?.cssvar?.global?.auto?.fraction?.rem?.(size!);
  const directions = directionMap[direction!];

  if (v != null && directions) {
    return directions.map((i) => [`${propertyPrefix}${i}`, v]);
  }
  return undefined;
}

/**
 * CSS RTL support to detect, replace and warn wrong left/right usages.
 */
export function presetRtl(checker?: CollectorChecker): Preset<Theme> {
  return {
    name: 'rtl-preset',
    shortcuts: [
      ['text-left', 'text-start x-rtl-start'],
      ['text-right', 'text-end x-rtl-end'],
    ],
    rules: [
      // Force physical directions (bypass RTL logic)
      [
        FORCE_PADDING_X,
        (match, context) => handlerForceDirectionSize('padding', match, context),
        { autocomplete: 'force-p(l|r)-<num>' },
      ],
      [
        FORCE_MARGIN_X,
        (match, context) => handlerForceDirectionSize('margin', match, context),
        { autocomplete: 'force-m(l|r)-<num>' },
      ],
      [
        FORCE_INSET_X,
        ([, direction, size], context) => {
          const v =
            context.theme.spacing?.[size || 'DEFAULT'] ??
            h.bracket?.cssvar?.global?.auto?.fraction?.rem?.(size!);
          if (v != null) {
            return [[direction === 'left' ? 'left' : 'right', v]];
          }
          return undefined;
        },
        { autocomplete: 'force-(left|right)-<num>' },
      ],
      [
        FORCE_TEXT_ALIGN,
        ([, direction]) => ({ 'text-align': direction! }),
        { autocomplete: 'force-text-(left|right)' },
      ],
      [
        FORCE_ROUNDED_X,
        ([, direction, size], context) =>
          handlerRounded(['', direction!, size ?? 'DEFAULT'], context),
        { autocomplete: 'force-rounded-(l|r)-<num>' },
      ],
      [
        FORCE_BORDER_X,
        ([, direction, size]) => handlerBorderSize(['', direction!, size || '1']),
        { autocomplete: 'force-border-(l|r)-<num>' },
      ],

      // RTL overrides
      // We need to move the dash out of the capturing group to avoid capturing it in the direction
      [
        PADDING_X,
        directionSizeRTL('padding', { l: 's', r: 'e' }, checker),
        { autocomplete: '(m|p)<directions>-<num>' },
      ],
      [
        MARGIN_X,
        directionSizeRTL('margin', { l: 's', r: 'e' }, checker),
        { autocomplete: '(m|p)<directions>-<num>' },
      ],
      [
        INSET_X,
        ([match = '', direction, size], context) => {
          if (!size) return undefined;
          const replacement = direction === 'left' ? 'inset-is' : 'inset-ie';

          const fullClass = context.rawSelector || match;
          const suggestedBase = `${replacement}-${size}`;
          const suggestedClass = fullClass.replace(match, suggestedBase);

          reportWarning(fullClass, suggestedClass, checker);

          return directionSize('inset')(['', direction === 'left' ? 'is' : 'ie', size], context);
        },
        { autocomplete: '(left|right)-<num>' },
      ],
      [
        RTL_MARKER,
        ([match = '', direction], context) => {
          const originalClass = context.rawSelector || match;

          const suggestedClass = originalClass.replace(
            direction === 'start' ? 'left' : 'right',
            direction!,
          );

          reportWarning(originalClass, suggestedClass, checker);

          // Return a cssvar with the warning message to satisfy UnoCSS
          // and avoid "unmatched utility" warning.
          return {
            [`--x-rtl-${direction!}`]: `"${originalClass} -> ${suggestedClass}"`,
          };
        },
        { autocomplete: 'text-(left|right)' },
      ],
      [
        ROUNDED_X,
        ([match = '', direction, size], context) => {
          if (!direction) return undefined;
          const replacementMap: Record<string, string> = {
            l: 'is',
            r: 'ie',
          };
          const replacement = replacementMap[direction];
          if (!replacement) return undefined;

          const fullClass = context.rawSelector || match;
          const suggestedBase = match.replace(`rounded-${direction}`, `rounded-${replacement}`);
          const suggestedClass = fullClass.replace(match, suggestedBase);

          reportWarning(fullClass, suggestedClass, checker);

          return handlerRounded(['', replacement, size ?? 'DEFAULT'], context);
        },
      ],
      [
        BORDER_X,
        ([match = '', direction, size], context) => {
          const replacement = direction === 'l' ? 'is' : 'ie';

          const fullClass = context.rawSelector || match;
          const suggestedBase = match.replace(`border-${direction!}`, `border-${replacement}`);
          const suggestedClass = fullClass.replace(match, suggestedBase);

          reportWarning(fullClass, suggestedClass, checker);

          return handlerBorderSize(['', replacement, size || '1']);
        },
      ],
    ],
  };
}
