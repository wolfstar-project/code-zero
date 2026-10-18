import { ForgeApiError } from 'forges';
import { describe, expect, it } from 'vitest';

import { ForgeRequestError, guarded } from './errors.js';
import { TOKEN } from './test-support/forge-fixture.js';

describe('guarded', () => {
  it('redacts a credential the forge echoed into its error body', async () => {
    const failure = guarded('github', [TOKEN], 'status report', () =>
      Promise.reject(new ForgeApiError('Bad request', 422, `{"message":"bad token ${TOKEN}"}`)),
    );
    await expect(failure).rejects.toBeInstanceOf(ForgeRequestError);
    await expect(failure).rejects.toMatchObject({ status: 422, forge: 'github' });
    const error = await failure.catch((caught: unknown) => caught);
    expect(String(error)).toContain('bad token [redacted]');
    expect(String(error)).not.toContain(TOKEN);
  });

  it('leaves errors that are not forge failures alone', async () => {
    const bug = new TypeError('a defect');
    await expect(guarded('github', [], 'read', () => Promise.reject(bug))).rejects.toBe(bug);
  });
});
