import { describe, expect, it } from 'vitest';

import { stripEmptyMessages } from '../../modules/i18n-strip-empty/index.js';

describe('stripEmptyMessages', () => {
  it('drops empty-string leaves so vue-i18n falls back instead of rendering ""', () => {
    expect(stripEmptyMessages({ kept: 'ciao', dropped: '' })).toEqual({ kept: 'ciao' });
  });

  it('removes objects left empty by the stripping', () => {
    expect(stripEmptyMessages({ section: { a: '', b: '' }, other: 'x' })).toEqual({ other: 'x' });
  });

  it('returns undefined when nothing is left', () => {
    expect(stripEmptyMessages({ a: '', nested: { b: '' } })).toBeUndefined();
  });

  it('keeps non-string leaves and arrays untouched', () => {
    expect(stripEmptyMessages({ n: 0, flag: false, list: ['x', ''] })).toEqual({
      n: 0,
      flag: false,
      list: ['x', ''],
    });
  });
});
