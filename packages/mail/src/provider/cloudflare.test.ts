import { describe, expect, it, vi } from 'vitest';

import { createCloudflareProvider, type CloudflareEmailBinding } from './cloudflare.js';
import type { OutgoingMail } from './types.js';

const REFUSED_PATTERN = /cloudflare email rejected the message: E_SENDER_NOT_VERIFIED/;

const mail: OutgoingMail = {
  to: 'operator@example.com',
  subject: 'Reset your password',
  html: '<a href="https://example.com/reset?token=secret-token">Reset</a>',
  text: 'https://example.com/reset?token=secret-token',
  from: 'noreply@example.com',
};

/** Email Service refuses a message by throwing an `Error` that carries a stable `code`. */
function refusal(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('createCloudflareProvider', () => {
  it('hands the rendered message to the binding', async () => {
    const send = vi.fn<CloudflareEmailBinding['send']>().mockResolvedValue({ messageId: 'm1' });

    await createCloudflareProvider({ binding: () => ({ send }) })(mail);

    expect(send).toHaveBeenCalledExactlyOnceWith({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  });

  it('asks for the binding on every message, not once at startup', async () => {
    const send = vi.fn<CloudflareEmailBinding['send']>().mockResolvedValue(undefined);
    const binding = vi.fn<() => CloudflareEmailBinding>(() => ({ send }));
    const provider = createCloudflareProvider({ binding });

    await provider(mail);
    await provider(mail);

    // A Worker's bindings arrive with the request being served.
    expect(binding).toHaveBeenCalledTimes(2);
  });

  it('rejects with the refusal code instead of resolving quietly', async () => {
    const send = vi
      .fn<CloudflareEmailBinding['send']>()
      .mockRejectedValue(refusal('E_SENDER_NOT_VERIFIED', 'operator@example.com is not allowed'));

    await expect(createCloudflareProvider({ binding: () => ({ send }) })(mail)).rejects.toThrow(
      REFUSED_PATTERN,
    );
  });

  it('keeps the recipient and the message body out of the error', async () => {
    const send = vi
      .fn<CloudflareEmailBinding['send']>()
      .mockRejectedValue(refusal('E_RECIPIENT_NOT_ALLOWED', 'operator@example.com is not allowed'));

    const error = await createCloudflareProvider({ binding: () => ({ send }) })(mail).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) return;
    expect(error.message).not.toContain('operator@example.com');
    expect(error.message).not.toContain('secret-token');
  });

  it('rejects when the binding is missing from the request', async () => {
    const provider = createCloudflareProvider({
      binding: () => {
        throw new Error('the EMAIL binding is not configured on this Worker');
      },
    });

    // Resolving the binding is part of delivering; a Worker without one must not drop the mail.
    await expect(provider(mail)).rejects.toThrow('EMAIL binding');
  });
});
