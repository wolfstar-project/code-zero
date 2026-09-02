import { describe, expect, it, vi } from 'vitest';

import { createMailer, sendEmail } from './mail.js';
import type { OutgoingMail } from './provider/types.js';

const INLINE_STYLE_PATTERN = /style="/;
/** The call-to-action's light-mode fill, which only reaches the anchor if utilities were inlined. */
const INLINED_BUTTON_FILL_PATTERN = /<a[^>]+style="[^"]*background-color: #1c6a00[^"]*"/;
const DARK_MODE_MEDIA_QUERY_PATTERN = /@media \(prefers-color-scheme: dark\)/;
const CLASS_ATTRIBUTE_PATTERN = /class="([^"]*)"/g;
/** Maizzle's `safeSelectors` step rewrites `dark:` to `dark-`, so that prefix marks the hooks. */
const DARK_VARIANT_CLASS_PATTERN = /^dark-/;
const WHITESPACE_PATTERN = /\s+/;
const MISSING_MAIL_FROM_PATTERN = /MAIL_FROM/;

/** Every class token left in the markup, so the assertion can name the offender it found. */
function classTokens(html: string): string[] {
  return [...html.matchAll(CLASS_ATTRIBUTE_PATTERN)].flatMap(([, value]) =>
    (value ?? '').split(WHITESPACE_PATTERN).filter(Boolean),
  );
}

/**
 * These render through the real Maizzle pipeline rather than a stub. Rendering is local and
 * deterministic, and the failure this guards against — a template that compiles but drops its
 * interpolated values — is invisible to a mocked renderer.
 */
function recordingProvider() {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    provider: (mail: OutgoingMail) => {
      sent.push(mail);
      return Promise.resolve();
    },
  };
}

/** Narrows `OutgoingMail | undefined` without an unsafe cast, failing the test with a clear message. */
function assertSent(mail: OutgoingMail | undefined): asserts mail is OutgoingMail {
  if (!mail) throw new Error('expected a message to have been recorded');
}

describe('sendEmail', () => {
  it('renders a public invitation link for the inviter to share', async () => {
    const { sent, provider } = recordingProvider();

    await sendEmail(
      {
        to: 'dana@example.com',
        templateId: 'publicInvitation',
        context: {
          inviterName: 'Dana',
          organizationName: 'Acme Ops',
          shareUrl: 'https://dashboard.example.com/invite?token=abc',
          maxUses: '12',
          expiresAt: '2026-08-24T20:00:00.000Z',
        },
      },
      { provider, from: 'noreply@example.com' },
    );

    const [mail] = sent;
    assertSent(mail);
    expect(mail.to).toBe('dana@example.com');
    expect(mail.subject).toBe('Your public Code Zero invitation is ready');
    expect(mail.html).toContain('Dana');
    expect(mail.html).toContain('Acme Ops');
    expect(mail.html).toContain('https://dashboard.example.com/invite?token=abc');
    expect(mail.text).toContain('https://dashboard.example.com/invite?token=abc');
    expect(mail.text).toContain('12');
    expect(mail.text).toContain('2026-08-24T20:00:00.000Z');
  });

  it('names the organization a private invitation grants access to', async () => {
    const { sent, provider } = recordingProvider();

    await sendEmail(
      {
        to: 'sam@example.com',
        templateId: 'privateInvitation',
        context: {
          name: 'Sam',
          inviterName: 'Dana',
          organizationName: 'Acme Ops',
          acceptUrl: 'https://dashboard.example.com/invite?token=abc',
        },
      },
      { provider, from: 'noreply@example.com' },
    );

    const [mail] = sent;
    assertSent(mail);
    expect(mail.to).toBe('sam@example.com');
    expect(mail.subject).toBe('You have been invited to Code Zero');
    expect(mail.text).toContain('Hello Sam,');
    expect(mail.text).toContain('Dana invited you to join Acme Ops on Code Zero.');
    // The token travels in this message and nowhere else, so the link has to survive both halves
    // of it: the button, and the pasteable address for clients that strip anchors.
    expect(mail.html).toContain('https://dashboard.example.com/invite?token=abc');
    expect(mail.text).toContain('https://dashboard.example.com/invite?token=abc');
  });

  it('renders the optional halves of a private invitation away rather than empty', async () => {
    // An app-wide invitation has no organization, and the inviter is not always asked for the
    // invitee's name: both arrive as empty strings, which must not reach the message as a stray
    // greeting or a sentence about joining nothing.
    const { sent, provider } = recordingProvider();

    await sendEmail(
      {
        to: 'sam@example.com',
        templateId: 'privateInvitation',
        context: {
          name: '',
          inviterName: 'Dana',
          organizationName: '',
          acceptUrl: 'https://dashboard.example.com/invite?token=abc',
        },
      },
      { provider, from: 'noreply@example.com' },
    );

    const [mail] = sent;
    assertSent(mail);
    expect(mail.text).toContain('Hello,');
    expect(mail.text).toContain('Dana invited you to create an account on Code Zero.');
    expect(mail.text).not.toContain('join');
  });

  it('inlines styles so the message survives clients that drop stylesheets', async () => {
    const { sent, provider } = recordingProvider();

    await sendEmail(
      {
        to: 'invitee@example.com',
        templateId: 'passwordReset',
        context: { name: 'Dana', resetUrl: 'https://dashboard.example.com/reset?token=abc' },
      },
      { provider, from: 'noreply@example.com' },
    );

    const [mail] = sent;
    assertSent(mail);
    expect(mail.html).toMatch(INLINE_STYLE_PATTERN);
    // Light-mode utilities have to end up in the style attribute itself, because the clients that
    // drop stylesheets are exactly the ones that would otherwise render the message unstyled.
    expect(mail.html).toMatch(INLINED_BUTTON_FILL_PATTERN);
    // Dark mode cannot be inlined: a media query has no element to attach to. It stays in the head
    // stylesheet, which is also why the classes it selects on legitimately survive purging.
    expect(mail.html).toMatch(DARK_MODE_MEDIA_QUERY_PATTERN);
    // So the guard is narrow rather than blanket: a surviving class that is *not* a dark-mode hook
    // means an ordinary utility went un-inlined and the CSS step silently did nothing.
    const leaked = classTokens(mail.html).filter(
      (token) => !DARK_VARIANT_CLASS_PATTERN.test(token),
    );
    expect(leaked).toEqual([]);
  });

  it('lets the caller override the registered subject', async () => {
    const { sent, provider } = recordingProvider();

    await sendEmail(
      {
        to: 'invitee@example.com',
        templateId: 'emailVerification',
        context: { name: 'Dana', verifyUrl: 'https://dashboard.example.com/verify?token=abc' },
        subject: 'Conferma il tuo indirizzo email',
      },
      { provider, from: 'noreply@example.com' },
    );

    const [mail] = sent;
    assertSent(mail);
    expect(mail.subject).toBe('Conferma il tuo indirizzo email');
  });

  it('refuses to send without a sender address rather than inventing one', async () => {
    const { provider } = recordingProvider();
    vi.stubEnv('MAIL_FROM', '');

    await expect(
      sendEmail(
        {
          to: 'invitee@example.com',
          templateId: 'emailVerification',
          context: { name: 'Dana', verifyUrl: 'https://dashboard.example.com/verify' },
        },
        { provider },
      ),
    ).rejects.toThrow(MISSING_MAIL_FROM_PATTERN);

    vi.unstubAllEnvs();
  });
});

describe('createMailer', () => {
  it('binds the provider and sender once for injection', async () => {
    const { sent, provider } = recordingProvider();
    const mailer = createMailer({ provider, from: 'ops@example.com' });

    await mailer({
      to: 'invitee@example.com',
      templateId: 'emailVerification',
      context: { name: 'Dana', verifyUrl: 'https://dashboard.example.com/verify?token=abc' },
    });

    const [mail] = sent;
    assertSent(mail);
    expect(mail.from).toBe('ops@example.com');
  });
});
