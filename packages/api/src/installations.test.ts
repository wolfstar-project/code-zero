import { describe, expect, it } from 'vitest';

import { createInstallationState } from './installations.js';

const SECRET = 'a-secret-that-is-long-enough-for-hmac-signing';
const TEN_MINUTES = 10 * 60 * 1000;
const AT_LEAST = /at least/;

describe('createInstallationState', () => {
  it('returns what it was given, for the same secret', async () => {
    const state = createInstallationState(SECRET);

    const token = await state.sign({ userId: 'usr_1', organizationId: 'org-a' });

    await expect(state.verify(token)).resolves.toEqual({
      userId: 'usr_1',
      organizationId: 'org-a',
    });
  });

  it('refuses a token signed with another secret', async () => {
    const token = await createInstallationState(SECRET).sign({
      userId: 'usr_1',
      organizationId: 'org-a',
    });

    await expect(
      createInstallationState('another-secret-entirely-different').verify(token),
    ).resolves.toBeNull();
  });

  it('refuses a token whose payload was changed', async () => {
    const state = createInstallationState(SECRET);
    const token = await state.sign({ userId: 'usr_1', organizationId: 'org-a' });
    const [, signature] = token.split('.');
    const forged = `${btoa(JSON.stringify({ userId: 'usr_2', organizationId: 'org-a', exp: Date.now() + TEN_MINUTES }))}.${signature}`;

    await expect(state.verify(forged)).resolves.toBeNull();
  });

  it('refuses a token after ten minutes', async () => {
    let now = 1_000_000;
    const state = createInstallationState(SECRET, () => now);
    const token = await state.sign({ userId: 'usr_1', organizationId: 'org-a' });

    now += TEN_MINUTES - 1;
    await expect(state.verify(token)).resolves.not.toBeNull();

    now += 2;
    await expect(state.verify(token)).resolves.toBeNull();
  });

  it.each(['', 'nodot', 'a.b.c', '.', 'not base64.not base64'])(
    'refuses a malformed token %j without throwing',
    async (token) => {
      await expect(createInstallationState(SECRET).verify(token)).resolves.toBeNull();
    },
  );

  it('refuses a secret too short to sign with', () => {
    expect(() => createInstallationState('short')).toThrow(AT_LEAST);
  });
});
