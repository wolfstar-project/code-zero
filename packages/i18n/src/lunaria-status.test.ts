import { describe, expect, it } from 'vitest';

import { formatMissingKey } from '../scripts/utils/lunaria-status.js';

describe('formatMissingKey', () => {
  it('joins the key path segments with dots after the localization path', () => {
    expect(formatMissingKey('locales/it/auth.json', ['auth', 'signIn', 'title'])).toBe(
      'locales/it/auth.json: auth.signIn.title',
    );
  });

  it('renders a top-level key without a separator', () => {
    expect(formatMissingKey('locales/it/common.json', ['appName'])).toBe(
      'locales/it/common.json: appName',
    );
  });
});
