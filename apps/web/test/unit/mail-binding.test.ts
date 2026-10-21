import { describe, expect, it, vi } from 'vitest';

import { emailBindingFrom } from '../../server/utils/mail-binding.js';

const MESSAGE = {
  from: 'noreply@example.com',
  to: 'operator@example.com',
  subject: 'Hello',
  html: '<p>Hello</p>',
  text: 'Hello',
};

describe('emailBindingFrom', () => {
  it('finds the send_email binding on the Worker environment', async () => {
    const send = vi.fn<(message: unknown) => Promise<unknown>>().mockResolvedValue(undefined);

    const binding = emailBindingFrom({ env: { EMAIL: { send } } });
    await binding?.send(MESSAGE);

    expect(send).toHaveBeenCalledExactlyOnceWith(MESSAGE);
  });

  it('answers nothing for a request that did not arrive through a Worker', () => {
    expect(emailBindingFrom(undefined)).toBeUndefined();
    expect(emailBindingFrom({})).toBeUndefined();
    expect(emailBindingFrom({ env: {} })).toBeUndefined();
  });

  it('ignores a binding that cannot send', () => {
    expect(emailBindingFrom({ env: { EMAIL: 'not-a-binding' } })).toBeUndefined();
    expect(emailBindingFrom({ env: { EMAIL: {} } })).toBeUndefined();
  });
});
