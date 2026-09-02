/**
 * Template registry.
 *
 * Every message the product can send is declared here with its Maizzle template and subject, so
 * that adding a template is one edit and callers address messages by id rather than by file path.
 */

/** Data each template interpolates. Keyed by template id so `sendEmail` can check the context. */
export interface MailTemplateContext {
  readonly privateInvitation: {
    /** The invitee's name when the inviter supplied one, otherwise empty. */
    readonly name: string;
    /** Who sent the invitation, shown so the recipient can judge whether it is expected. */
    readonly inviterName: string;
    /** The organization the invitation grants access to, or empty for an app-wide invitation. */
    readonly organizationName: string;
    /**
     * Absolute URL that redeems the invitation. Carries the only copy of the token, which is why
     * this message is the sole place it ever appears.
     */
    readonly acceptUrl: string;
  };
  readonly publicInvitation: {
    /** The person who created the link and receives this durable copy. */
    readonly inviterName: string;
    /** The organization the link grants access to, or empty for an app-wide invitation. */
    readonly organizationName: string;
    /** Absolute public URL the inviter can share with recipients. */
    readonly shareUrl: string;
    /** Human-readable use cap, or "Unlimited" when no cap was configured. */
    readonly maxUses: string;
    /** ISO timestamp, or "Never" when the invitation has no expiry. */
    readonly expiresAt: string;
  };
  readonly emailVerification: {
    readonly name: string;
    readonly verifyUrl: string;
  };
  readonly passwordReset: {
    readonly name: string;
    readonly resetUrl: string;
  };
}

export type MailTemplateId = keyof MailTemplateContext;

/** Context keys of one template, as the registry below spells them out. */
type MailTemplateField<Id extends MailTemplateId> = keyof MailTemplateContext[Id] & string;

/**
 * How a template uses one of its context fields.
 *
 * Templates are rendered to static markup at build time (`aube run mail:compile`), because
 * rendering a Vue SFC needs a bundler and the deployment that sends the message has none. A
 * branch therefore cannot be taken at send time: the compiler renders one variant per combination
 * of the `conditional` fields being filled or empty, and `sendEmail` picks the variant its own
 * context matches. `interpolated` fields are substituted into whichever variant was picked, so
 * marking a field `conditional` that the template only prints doubles the compiled output for
 * nothing.
 */
type MailTemplateFieldUse = 'interpolated' | 'conditional';

interface MailTemplateDefinition<Id extends MailTemplateId> {
  /** Path relative to this package's `emails/` directory. */
  readonly file: string;
  readonly subject: string;
  /**
   * Every field the template's context carries, and how the template uses it.
   *
   * Spelled out rather than derived from {@link MailTemplateContext}, which only exists at
   * compile time: the compiler needs the field names as values to render a placeholder for each.
   * The mapped type makes the two agree — a field that is added to the context and not listed
   * here, or listed here and not in the context, fails to type-check.
   */
  readonly fields: { readonly [Field in MailTemplateField<Id>]: MailTemplateFieldUse };
}

export const mailTemplates: {
  readonly [Id in MailTemplateId]: MailTemplateDefinition<Id>;
} = {
  privateInvitation: {
    file: 'PrivateInvitation.vue',
    subject: 'You have been invited to Code Zero',
    fields: {
      // The inviter is not always asked for the invitee's name, and an invitation can grant an
      // app-wide role rather than a membership: the template renders each half away when empty.
      name: 'conditional',
      organizationName: 'conditional',
      inviterName: 'interpolated',
      acceptUrl: 'interpolated',
    },
  },
  publicInvitation: {
    file: 'PublicInvitation.vue',
    subject: 'Your public Code Zero invitation is ready',
    fields: {
      organizationName: 'conditional',
      inviterName: 'interpolated',
      shareUrl: 'interpolated',
      maxUses: 'interpolated',
      expiresAt: 'interpolated',
    },
  },
  emailVerification: {
    file: 'EmailVerification.vue',
    subject: 'Confirm your email address',
    fields: { name: 'interpolated', verifyUrl: 'interpolated' },
  },
  passwordReset: {
    file: 'PasswordReset.vue',
    subject: 'Reset your password',
    fields: { name: 'interpolated', resetUrl: 'interpolated' },
  },
};

/**
 * Every template, in registry order.
 *
 * Listed rather than derived, because `Object.keys` cannot report the key type the registry's
 * mapped type guarantees, and asserting it back would be the one place a typo could hide.
 * `compiled.test.ts` holds this list to the registry.
 */
export const mailTemplateIds = [
  'privateInvitation',
  'publicInvitation',
  'emailVerification',
  'passwordReset',
] as const satisfies readonly MailTemplateId[];

/**
 * Every field one template's context carries, in the order it declares them.
 *
 * That order is what names a variant, so the compiler and the sender both read it from here
 * rather than sorting or re-deriving it. Field names are plain strings here: the registry's
 * mapped type is what ties them to the context, and both callers address a context by name.
 */
export function mailTemplateFields(id: MailTemplateId): readonly string[] {
  return Object.keys(mailTemplates[id].fields);
}

/** The subset of {@link mailTemplateFields} the template branches on rather than only printing. */
export function mailTemplateConditionalFields(id: MailTemplateId): readonly string[] {
  const fields: Readonly<Record<string, MailTemplateFieldUse>> = mailTemplates[id].fields;
  return mailTemplateFields(id).filter((field) => fields[field] === 'conditional');
}
