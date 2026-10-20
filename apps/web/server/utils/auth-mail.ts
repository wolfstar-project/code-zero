import type { AuthDatabaseOptions } from '@code-zero/auth';
import type { SendEmail } from '@code-zero/mail';

/**
 * Every message Better Auth's policy may send, bound to the app's mail transport.
 *
 * Each callback exists because a template exists for it in `packages/mail`; enabling the matching
 * policy flag without the callback is a startup error in `packages/auth`, not a no-op, which is
 * why every flag an operator can turn on is covered here. `packages/auth` declares these
 * contracts structurally and never imports `@code-zero/mail`, so this is the one place the two
 * meet.
 */
export function authMailDelivery(
  sendMail: SendEmail,
): Required<
  Pick<
    AuthDatabaseOptions,
    | 'sendVerificationEmail'
    | 'sendPasswordResetEmail'
    | 'sendMagicLinkEmail'
    | 'sendTwoFactorOtpEmail'
    | 'sendPrivateInvitationEmail'
    | 'sendPublicInvitationEmail'
  >
> {
  return {
    sendVerificationEmail: ({ to, name, verifyUrl }) =>
      sendMail({ to, templateId: 'emailVerification', context: { name, verifyUrl } }),
    sendPasswordResetEmail: ({ to, name, resetUrl }) =>
      sendMail({ to, templateId: 'passwordReset', context: { name, resetUrl } }),
    // The link is the credential, so it goes into the message and nowhere else: the mailer never
    // logs a context, and this callback has nothing to add to it.
    sendMagicLinkEmail: ({ to, signInUrl }) =>
      sendMail({ to, templateId: 'magicLink', context: { signInUrl } }),
    // Likewise for the code, which the template prints once and nothing here ever logs.
    sendTwoFactorOtpEmail: ({ to, name, code }) =>
      sendMail({ to, templateId: 'twoFactorOtp', context: { name, code } }),
    // The enrollment plugin deliberately never returns a private invitation's link to whoever
    // created it, so this callback is the only path the token travels. The template renders
    // the optional halves away rather than printing "null": an invitation with no invitee name
    // or no organization is the ordinary app-wide case, not a missing value.
    sendPrivateInvitationEmail: ({ to, name, inviterName, organizationName, acceptUrl }) =>
      sendMail({
        to,
        templateId: 'privateInvitation',
        context: {
          name: name ?? '',
          inviterName,
          organizationName: organizationName ?? '',
          acceptUrl,
        },
      }),
    sendPublicInvitationEmail: ({
      to,
      inviterName,
      organizationName,
      shareUrl,
      maxUses,
      expiresAt,
    }) =>
      sendMail({
        to,
        templateId: 'publicInvitation',
        context: {
          inviterName,
          organizationName: organizationName ?? '',
          shareUrl,
          maxUses: maxUses === null ? 'Unlimited' : String(maxUses),
          expiresAt: expiresAt?.toISOString() ?? 'Never',
        },
      }),
  };
}
