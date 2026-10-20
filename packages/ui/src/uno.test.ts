import { createGenerator } from 'unocss';
import { describe, expect, it } from 'vitest';

import { baseShortcuts, defineCodeZeroUno } from './uno.js';

const HEIGHT_11 = /height:\s*calc\(var\(--spacing\) \* 11\)|height:\s*2\.75rem/;

describe('defineCodeZeroUno', () => {
  it('resolves brand colours through the CSS custom properties', async () => {
    const generator = await createGenerator(defineCodeZeroUno({ checkers: false }));
    const { css } = await generator.generate('bg-panel text-accent', { preflights: false });
    expect(css).toContain('var(--cz-panel)');
    expect(css).toContain('var(--cz-accent)');
  });

  it('lets an app define its own density on top of the shared shortcuts', async () => {
    const generator = await createGenerator(
      defineCodeZeroUno({ checkers: false, shortcuts: [['btn', 'h-11 border px-5']] }),
    );
    const { css } = await generator.generate('btn-subtle', { preflights: false });
    expect(css).toMatch(HEIGHT_11);
    expect(css).toContain('var(--cz-raised)');
  });

  it('merges extra text steps without dropping the base ones', () => {
    const config = defineCodeZeroUno({ checkers: false, text: { display: { fontSize: '4rem' } } });
    expect(config.theme?.text).toMatchObject({
      '3xs': { fontSize: '0.625rem' },
      display: { fontSize: '4rem' },
    });
  });

  it('leaves the dev-time checkers out when asked', () => {
    expect(defineCodeZeroUno({ checkers: false }).presets).toHaveLength(1);
    expect(defineCodeZeroUno({ checkers: true }).presets).toHaveLength(3);
  });

  it('keeps every shared shortcut name unique', () => {
    const names = baseShortcuts.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
  });
});
