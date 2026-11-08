import type { CloudflareEmailBinding } from '@code-zero/mail';

/** Narrows what Nitro leaves untyped on `event.context.cloudflare` to the `EMAIL` binding. */
export function emailBindingFrom(cloudflare: unknown): CloudflareEmailBinding | undefined {
  if (typeof cloudflare !== 'object' || cloudflare === null || !('env' in cloudflare)) {
    return undefined;
  }
  const { env } = cloudflare;
  if (typeof env !== 'object' || env === null || !('EMAIL' in env)) return undefined;
  const { EMAIL: binding } = env;
  return isEmailBinding(binding) ? binding : undefined;
}

function isEmailBinding(value: unknown): value is CloudflareEmailBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    'send' in value &&
    typeof value.send === 'function'
  );
}

/**
 * The Worker's `send_email` binding for the request being served.
 *
 * Read from the request rather than held at startup, because a Worker receives its bindings with
 * each request. Sending outside one, or from a Worker deployed without the binding, is a
 * configuration error and says so.
 */
export function emailBinding(): CloudflareEmailBinding {
  const binding = emailBindingFrom(useEvent().context.cloudflare);
  if (!binding) throw new Error('the EMAIL send_email binding is not configured on this Worker');
  return binding;
}
