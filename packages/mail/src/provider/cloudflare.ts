import type { MailProvider, OutgoingMail } from './types.js';

/**
 * The part of a Workers `send_email` binding (Cloudflare Email Service) this transport calls.
 *
 * Declared here rather than imported from `@cloudflare/workers-types` so the package stays free of
 * a platform dependency: the binding only exists inside a Worker, and the composition root hands
 * it over.
 */
export interface CloudflareEmailBinding {
  send(message: {
    readonly from: string;
    readonly to: string;
    readonly subject: string;
    readonly html: string;
    readonly text: string;
  }): Promise<unknown>;
}

/** Options the Cloudflare transport needs. */
export interface CloudflareProviderOptions {
  /**
   * Resolves the binding for the work in progress.
   *
   * A function rather than a value because a Worker receives its bindings with each request, not
   * when the module loads, so the transport cannot hold one from startup.
   */
  readonly binding: () => CloudflareEmailBinding;
}

/** Email Service rejects a message by throwing an `Error` with a stable `code`. */
function failureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    if (typeof code === 'string') return code;
  }
  return 'unknown error';
}

/**
 * Cloudflare Email Service transport, for the managed cloud's Worker.
 *
 * Sending goes through the Worker's `send_email` binding, so there is no API key to provision or
 * leak: the binding is the credential, and the sender domain must be onboarded to Email Service.
 */
export function createCloudflareProvider(options: CloudflareProviderOptions): MailProvider {
  return async (mail: OutgoingMail) => {
    // Resolved outside the `try`: a Worker without the binding fails with its own explanation, not
    // as a refusal from the service.
    const binding = options.binding();
    try {
      await binding.send({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
    } catch (error) {
      // The message carries only the code: the service's own text can quote the recipient, and a
      // caller needs to know why the message was refused, not who it was for. The original rides
      // along as `cause` for whoever debugs it.
      throw new Error(`cloudflare email rejected the message: ${failureCode(error)}`, {
        cause: error,
      });
    }
  };
}
