import { createCloudflareProvider, type CloudflareEmailBinding } from './cloudflare.js';
import { createConsoleProvider } from './console.js';
import { createResendProvider } from './resend.js';
import { createSmtpProvider } from './smtp.js';
import type { MailProvider } from './types.js';

export {
  createCloudflareProvider,
  type CloudflareEmailBinding,
  type CloudflareProviderOptions,
} from './cloudflare.js';
export { createConsoleProvider } from './console.js';
export { createResendProvider, type ResendProviderOptions } from './resend.js';
export { createSmtpProvider, type SmtpProviderOptions } from './smtp.js';
export type { MailProvider, OutgoingMail } from './types.js';

/** Transports a deployment can select through `MAIL_PROVIDER`. */
export const MAIL_PROVIDER_NAMES = ['console', 'resend', 'smtp', 'cloudflare'] as const;

export type MailProviderName = (typeof MAIL_PROVIDER_NAMES)[number];

function isProviderName(value: string): value is MailProviderName {
  return (MAIL_PROVIDER_NAMES as readonly string[]).includes(value);
}

/** Missing configuration is a deployment error; a default would send through the wrong transport. */
function requireEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

const DECIMAL_PORT_PATTERN = /^\d+$/u;

function requirePort(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): number {
  const raw = requireEnvironmentValue(environment, name);
  // Validate the whole value: `Number.parseInt` would truncate `587abc` to a usable port.
  if (!DECIMAL_PORT_PATTERN.test(raw)) throw new Error(`invalid ${name}: expected a port number`);
  const port = Number.parseInt(raw, 10);
  if (port < 1 || port > 65_535) throw new Error(`invalid ${name}: expected a port number`);
  return port;
}

/**
 * Resolve and validate the configured transport name without constructing the transport.
 *
 * Composition roots use this to tell a delivering transport apart from the console default when
 * a feature (such as organization invitations) must not silently log mail instead of sending it.
 * A Resend credential selects Resend only when no provider was named explicitly, matching hosted
 * integrations that provision `RESEND_API_KEY` alone without overriding an operator's choice.
 */
export function mailProviderNameFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): MailProviderName {
  const configured =
    environment.MAIL_PROVIDER === undefined
      ? environment.RESEND_API_KEY?.trim()
        ? 'resend'
        : 'console'
      : environment.MAIL_PROVIDER.trim();
  if (!isProviderName(configured))
    throw new Error(
      `invalid MAIL_PROVIDER: expected one of ${MAIL_PROVIDER_NAMES.join(', ')}, received ${configured}`,
    );
  return configured;
}

/** What the environment cannot name: values only the hosting platform can hand over. */
export interface MailProviderBindings {
  /**
   * The Worker's `send_email` binding, resolved per request. Required to select `cloudflare`,
   * which has no credential to read from the environment: the binding is the credential.
   */
  readonly cloudflareEmail?: () => CloudflareEmailBinding;
}

/**
 * Resolve the configured transport.
 *
 * The single place delivery backends are selected, so callers depend on {@link MailProvider}
 * rather than on any one SDK. Defaults to the console provider when no provider or Resend
 * credential is present: a deployment that has not chosen a transport should log rather than fail
 * to deliver silently, and no error message here echoes a credential.
 */
export function mailProviderFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  bindings: MailProviderBindings = {},
): MailProvider {
  const configured = mailProviderNameFromEnvironment(environment);

  if (configured === 'cloudflare') {
    if (!bindings.cloudflareEmail)
      throw new Error('MAIL_PROVIDER=cloudflare needs a Cloudflare Worker send_email binding');
    return createCloudflareProvider({ binding: bindings.cloudflareEmail });
  }

  if (configured === 'resend')
    return createResendProvider({
      apiKey: requireEnvironmentValue(environment, 'RESEND_API_KEY'),
    });

  if (configured === 'smtp')
    return createSmtpProvider({
      host: requireEnvironmentValue(environment, 'SMTP_HOST'),
      port: requirePort(environment, 'SMTP_PORT'),
      secure: environment.SMTP_SECURE === 'true',
      ...(environment.SMTP_USER?.trim() ? { user: environment.SMTP_USER.trim() } : {}),
      ...(environment.SMTP_PASSWORD ? { password: environment.SMTP_PASSWORD } : {}),
    });

  // The only remaining member of MailProviderName, narrowed by isProviderName above.
  return createConsoleProvider();
}
