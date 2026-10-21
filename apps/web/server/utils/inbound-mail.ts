import { parseInboundForwards, routeInboundMail } from '@code-zero/mail';

/** The part of an Email Routing message this app uses: who it is for and the two ways to settle it. */
export interface InboundMessage {
  readonly to: string;
  forward(destination: string): Promise<void>;
  setReject(reason: string): void;
}

/** Narrows the Worker `env` Nitro hands the email hook to a string variable. */
export function stringVariable(env: unknown, name: string): string | undefined {
  if (typeof env !== 'object' || env === null) return undefined;
  const value: unknown = Object.entries(env).find(([key]) => key === name)?.[1];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Settles one message that Email Routing delivered to this Worker.
 *
 * It forwards to the address the alias is configured for and refuses everything else. The message
 * body is never read, so a hostile sender gets nothing from this code beyond the alias lookup, and
 * neither the sender nor the destination is logged: the log line names the alias and the outcome.
 * Every path settles the message, because a Worker that returns without doing so accepts and drops
 * mail the sender believes was delivered.
 */
export async function settleInboundMail(
  message: InboundMessage,
  forwardsConfiguration: string | undefined,
  log: { info(line: string): void; error(line: string): void } = console,
): Promise<void> {
  let decision;
  try {
    decision = routeInboundMail(parseInboundForwards(forwardsConfiguration), message.to);
  } catch (error) {
    // A malformed MAIL_INBOUND_FORWARDS is the operator's to fix; the sender is told only that
    // delivery is unavailable.
    log.error(
      `[mail] inbound routing is misconfigured: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    message.setReject('Delivery is temporarily unavailable');
    return;
  }

  if (decision.action === 'reject') {
    log.info(`[mail] refused inbound mail for ${message.to}`);
    message.setReject(decision.reason);
    return;
  }

  try {
    await message.forward(decision.to);
    log.info(`[mail] forwarded inbound mail for ${message.to}`);
  } catch {
    // The destination must be a verified address in Email Routing; the runtime's own message can
    // quote it, so only the alias is reported.
    log.error(`[mail] could not forward inbound mail for ${message.to}`);
    message.setReject('Delivery failed');
  }
}
