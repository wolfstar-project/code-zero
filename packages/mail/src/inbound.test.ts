import { describe, expect, it } from 'vitest';

import { parseInboundForwards, routeInboundMail } from './inbound.js';

const MALFORMED_ENTRY_PATTERN = /invalid entry in MAIL_INBOUND_FORWARDS/;
const INVALID_DESTINATION_PATTERN = /invalid destination address/;
const INVALID_ALIAS_PATTERN = /invalid alias address/;
const LEAKED_DESTINATION_PATTERN = /private-owner/;

describe('parseInboundForwards', () => {
  it('reads aliases separated by commas, semicolons, spaces, and newlines', () => {
    const forwards = parseInboundForwards(
      'support@code-zero.dev=a@example.net, security@code-zero.dev=b@example.net;\nabuse@code-zero.dev=c@example.net',
    );

    expect([...forwards.keys()]).toEqual([
      'support@code-zero.dev',
      'security@code-zero.dev',
      'abuse@code-zero.dev',
    ]);
  });

  it('treats an absent or empty value as nothing to forward', () => {
    expect(parseInboundForwards(undefined).size).toBe(0);
    expect(parseInboundForwards('  \n ').size).toBe(0);
  });

  it('rejects the whole value when one entry is malformed instead of skipping it', () => {
    // Skipping would turn an alias the operator meant to forward into one that refuses.
    expect(() => parseInboundForwards('support@code-zero.dev=a@example.net,broken')).toThrow(
      MALFORMED_ENTRY_PATTERN,
    );
    expect(() => parseInboundForwards('a@b.co=c@d.co=e@f.co')).toThrow(MALFORMED_ENTRY_PATTERN);
  });

  it('rejects addresses that are not addresses', () => {
    expect(() => parseInboundForwards('support@code-zero.dev=not-an-address')).toThrow(
      INVALID_DESTINATION_PATTERN,
    );
    expect(() => parseInboundForwards('support=a@example.net')).toThrow(INVALID_ALIAS_PATTERN);
  });

  it('never echoes a destination address in its errors', () => {
    expect(() => parseInboundForwards('support@code-zero.dev=private-owner')).toThrow(
      expect.not.stringMatching(LEAKED_DESTINATION_PATTERN),
    );
  });
});

describe('routeInboundMail', () => {
  const forwards = parseInboundForwards('Support@Code-Zero.dev=owner@example.net');

  it('forwards mail for a configured alias, whatever its letter case', () => {
    expect(routeInboundMail(forwards, 'SUPPORT@code-zero.dev')).toEqual({
      action: 'forward',
      to: 'owner@example.net',
    });
  });

  it('refuses mail for any other address', () => {
    expect(routeInboundMail(forwards, 'anyone@code-zero.dev')).toEqual({
      action: 'reject',
      reason: 'No such recipient',
    });
  });

  it('refuses everything when nothing is configured', () => {
    expect(routeInboundMail(parseInboundForwards(undefined), 'support@code-zero.dev').action).toBe(
      'reject',
    );
  });

  it('does not match an alias by prefix or by a different domain', () => {
    expect(routeInboundMail(forwards, 'support@code-zero.dev.evil.test').action).toBe('reject');
    expect(routeInboundMail(forwards, 'xsupport@code-zero.dev').action).toBe('reject');
  });
});
