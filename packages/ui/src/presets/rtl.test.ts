import { createGenerator, presetWind4 } from 'unocss';
import { describe, expect, it } from 'vitest';

import { presetRtl } from './rtl.js';

async function generate(classes: string) {
  const warnings: string[] = [];
  const generator = await createGenerator({
    presets: [presetWind4(), presetRtl((warning) => warnings.push(warning))],
  });
  const { css } = await generator.generate(classes, { preflights: false });
  return { css, warnings };
}

describe('presetRtl', () => {
  it('rewrites a physical padding to its logical side and warns', async () => {
    const { css, warnings } = await generate('pl-2');
    expect(css).toContain('padding-inline-start');
    expect(css).not.toContain('padding-left');
    expect(warnings).toEqual([expect.stringContaining("use 'ps-2' instead")]);
  });

  it('keeps the physical side behind the force- escape hatch without warning', async () => {
    const { css, warnings } = await generate('force-pr-2');
    expect(css).toContain('padding-right');
    expect(warnings).toEqual([]);
  });

  it('maps a physical corner radius to the logical corners', async () => {
    const { css, warnings } = await generate('rounded-l-full');
    expect(css).toContain('border-start-start-radius');
    expect(warnings).toHaveLength(1);
  });

  it('leaves logical utilities alone', async () => {
    const { warnings } = await generate('ps-2 me-4 text-start');
    expect(warnings).toEqual([]);
  });
});
