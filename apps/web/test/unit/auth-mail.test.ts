import { authBetterAuthOptions } from '@code-zero/auth';
import { defaultAuthConfig } from '@code-zero/auth/config';
import { createMailer, type OutgoingMail } from '@code-zero/mail';
import { describe, expect, it } from 'vitest';

import { authMailDelivery } from '../../server/utils/auth-mail.js';

/**
 * Binds the real mailer to a recording provider. The connection string is never dialled:
 * `authBetterAuthOptions` builds a lazy pool, and nothing here queries it.
 */
function recordingDelivery() {
  const sent: OutgoingMail[] = [];
  const delivery = authMailDelivery(
    createMailer({
      from: 'code-zero@example.test',
      provider: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    }),
  );
  return { sent, delivery };
}

describe('auth email delivery', () => {
  it('lets a deployment turn on both email sign-in options without failing at startup', () => {
    const { delivery } = recordingDelivery();

    // `packages/auth` refuses either flag without its callback; the app has to supply both.
    const options = authBetterAuthOptions({
      databaseUrl: 'postgres://localhost/unused',
      config: {
        ...defaultAuthConfig,
        enableMagicLink: true,
        enableTwoFactor: true,
        enableTwoFactorEmailOtp: true,
      },
      ...delivery,
    });

    const ids = options.plugins.map((plugin) => plugin.id);
    expect(ids).toContain('magic-link');
    expect(ids).toContain('two-factor');
  });

  it('delivers the sign-in link to the address that asked for it', async () => {
    const { sent, delivery } = recordingDelivery();
    const signInUrl = 'https://app.example.test/verify?token=example&callbackURL=%2F';

    await delivery.sendMagicLinkEmail({ to: 'ada@example.test', signInUrl });

    const [mail] = sent;
    expect(mail).toMatchObject({ to: 'ada@example.test', subject: 'Sign in to Code Zero' });
    // The link is the credential: both halves of the message have to carry it unchanged, the
    // button for clients that render anchors and the pasteable text for the ones that strip them.
    expect(mail?.html).toContain(
      'https://app.example.test/verify?token=example&amp;callbackURL=%2F',
    );
    expect(mail?.text).toContain(signInUrl);
  });

  it('delivers the second-factor code to the account, escaping the name around it', async () => {
    const { sent, delivery } = recordingDelivery();

    await delivery.sendTwoFactorOtpEmail({ to: 'ada@example.test', name: '<Ada>', code: '123456' });

    const [mail] = sent;
    expect(mail).toMatchObject({
      to: 'ada@example.test',
      subject: 'Your Code Zero verification code',
    });
    expect(mail?.text).toContain('123456');
    expect(mail?.html).toContain('123456');
    // The name is whatever the account typed at sign-up, substituted into markup.
    expect(mail?.html).toContain('&lt;Ada&gt;');
    expect(mail?.html).not.toContain('<Ada>');
  });
});
