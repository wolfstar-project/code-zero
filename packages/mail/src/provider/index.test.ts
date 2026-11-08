import { describe, expect, it, vi } from 'vitest';

import {
  createConsoleProvider,
  mailProviderFromEnvironment,
  mailProviderNameFromEnvironment,
} from './index.js';

const INVALID_MAIL_PROVIDER_PATTERN = /invalid MAIL_PROVIDER/;
const MISSING_RESEND_API_KEY_PATTERN = /RESEND_API_KEY/;
const MISSING_CLOUDFLARE_BINDING_PATTERN = /send_email binding/;
const MISSING_SMTP_HOST_PATTERN = /SMTP_HOST/;
const MISSING_SMTP_PORT_PATTERN = /SMTP_PORT/;
const LEAKED_SMTP_PASSWORD_PATTERN = /hunter2/;

/**
 * Provider selection is deployment configuration, so the failure modes that matter are the
 * misconfigured ones: they must fail loudly rather than fall back to a transport the operator did
 * not choose.
 */
describe('mailProviderFromEnvironment', () => {
  it('defaults to the console provider when nothing is configured', () => {
    expect(() => mailProviderFromEnvironment({})).not.toThrow();
  });

  it('rejects an unknown provider name instead of silently defaulting', () => {
    expect(() => mailProviderFromEnvironment({ MAIL_PROVIDER: 'carrier-pigeon' })).toThrow(
      INVALID_MAIL_PROVIDER_PATTERN,
    );
  });

  it('requires an API key before selecting Resend', () => {
    expect(() => mailProviderFromEnvironment({ MAIL_PROVIDER: 'resend' })).toThrow(
      MISSING_RESEND_API_KEY_PATTERN,
    );
  });

  it('requires the Worker binding before selecting Cloudflare', () => {
    // There is no credential in the environment to fall back on, so a missing binding is a
    // deployment error, not a reason to log or to pick another transport.
    expect(() => mailProviderFromEnvironment({ MAIL_PROVIDER: 'cloudflare' })).toThrow(
      MISSING_CLOUDFLARE_BINDING_PATTERN,
    );
    expect(() =>
      mailProviderFromEnvironment(
        { MAIL_PROVIDER: 'cloudflare' },
        { cloudflareEmail: () => ({ send: () => Promise.resolve() }) },
      ),
    ).not.toThrow();
  });

  it('requires host and port before selecting SMTP', () => {
    expect(() => mailProviderFromEnvironment({ MAIL_PROVIDER: 'smtp' })).toThrow(
      MISSING_SMTP_HOST_PATTERN,
    );
    expect(() =>
      mailProviderFromEnvironment({ MAIL_PROVIDER: 'smtp', SMTP_HOST: 'localhost' }),
    ).toThrow(MISSING_SMTP_PORT_PATTERN);
  });

  it('rejects a port that is not a whole number in range', () => {
    for (const port of ['587abc', '0', '70000']) {
      expect(() =>
        mailProviderFromEnvironment({
          MAIL_PROVIDER: 'smtp',
          SMTP_HOST: 'localhost',
          SMTP_PORT: port,
        }),
      ).toThrow(MISSING_SMTP_PORT_PATTERN);
    }
  });

  it('never echoes a credential in its error messages', () => {
    // A thrown connection string or key routinely ends up in a crash log.
    expect(() =>
      mailProviderFromEnvironment({ MAIL_PROVIDER: 'smtp', SMTP_PASSWORD: 'hunter2' }),
    ).toThrow(expect.not.stringMatching(LEAKED_SMTP_PASSWORD_PATTERN));
  });
});

/**
 * Composition roots branch on this name to withhold capabilities (such as invitation delivery)
 * from the non-delivering console default, so it must report exactly what was configured.
 */
describe('mailProviderNameFromEnvironment', () => {
  it('reports the console default when nothing is configured', () => {
    expect(mailProviderNameFromEnvironment({})).toBe('console');
  });

  it('selects Resend when its integration credential is present', () => {
    expect(mailProviderNameFromEnvironment({ RESEND_API_KEY: 're_integration' })).toBe('resend');
  });

  it('reports the configured transport name', () => {
    expect(mailProviderNameFromEnvironment({ MAIL_PROVIDER: 'smtp' })).toBe('smtp');
    expect(mailProviderNameFromEnvironment({ MAIL_PROVIDER: 'cloudflare' })).toBe('cloudflare');
  });

  it('rejects an unknown provider name instead of silently defaulting', () => {
    expect(() => mailProviderNameFromEnvironment({ MAIL_PROVIDER: 'carrier-pigeon' })).toThrow(
      INVALID_MAIL_PROVIDER_PATTERN,
    );
  });
});

describe('createConsoleProvider', () => {
  it('reports the message without logging its body', async () => {
    const log = vi.fn<(message: string) => void>();
    await createConsoleProvider(log)({
      to: 'operator@example.com',
      subject: 'Reset your password',
      html: '<a href="https://example.com/reset?token=secret-token">Reset</a>',
      text: 'https://example.com/reset?token=secret-token',
      from: 'noreply@example.com',
    });

    expect(log).toHaveBeenCalledOnce();
    const [message] = log.mock.calls[0] ?? [];
    expect(message).toContain('operator@example.com');
    // Invitation and reset links are single-use credentials; they must not reach the log.
    expect(message).not.toContain('secret-token');
  });
});
