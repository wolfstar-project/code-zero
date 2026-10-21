/**
 * Routing for mail that arrives at the managed cloud's own addresses.
 *
 * The cloud receives mail through Cloudflare Email Routing, which hands each message to the
 * Worker. Nothing here reads a message: the only input is the address it was sent to, and the only
 * outcomes are to pass it on to an address an operator named or to refuse it. A message that is not
 * addressed to a configured alias is refused rather than dropped, so a sender learns it did not
 * arrive.
 */

/** Where mail for one alias goes. Keys are lower-cased addresses. */
export type InboundForwards = ReadonlyMap<string, string>;

/** What to do with one message. */
export type InboundDecision =
  | { readonly action: 'forward'; readonly to: string }
  | { readonly action: 'reject'; readonly reason: string };

/** Refusal text for a sender: it names neither the configured aliases nor why one did not match. */
const REJECTION_REASON = 'No such recipient';

const ADDRESS_PATTERN = /^[^\s@=,;]+@[^\s@=,;]+\.[^\s@=,;]+$/u;
const ENTRY_SEPARATOR_PATTERN = /[\s,;]+/u;

function requireAddress(value: string, role: string): string {
  if (!ADDRESS_PATTERN.test(value))
    throw new Error(`invalid ${role} address in MAIL_INBOUND_FORWARDS`);
  return value.toLowerCase();
}

/**
 * Parse `MAIL_INBOUND_FORWARDS`: entries of `alias@example.com=destination@example.net`, separated
 * by commas, semicolons, or whitespace.
 *
 * An empty value is a valid configuration (nothing is forwarded, every message is refused). A
 * malformed entry is a deployment error and fails the whole value: skipping it would quietly turn
 * an alias the operator meant to forward into one that refuses. The error names the problem, never
 * the entry, because the destination is a personal address.
 */
export function parseInboundForwards(raw: string | undefined): InboundForwards {
  const forwards = new Map<string, string>();
  for (const entry of (raw ?? '').split(ENTRY_SEPARATOR_PATTERN)) {
    if (!entry) continue;
    const parts = entry.split('=');
    if (parts.length !== 2)
      throw new Error('invalid entry in MAIL_INBOUND_FORWARDS: expected alias=destination');
    const [alias = '', destination = ''] = parts;
    forwards.set(requireAddress(alias, 'alias'), requireAddress(destination, 'destination'));
  }
  return forwards;
}

/** Decide where a message addressed to `recipient` goes. */
export function routeInboundMail(forwards: InboundForwards, recipient: string): InboundDecision {
  const to = forwards.get(recipient.trim().toLowerCase());
  return to === undefined
    ? { action: 'reject', reason: REJECTION_REASON }
    : { action: 'forward', to };
}
