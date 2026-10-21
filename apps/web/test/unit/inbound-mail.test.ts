import { describe, expect, it, vi } from 'vitest';

import { settleInboundMail, stringVariable } from '../../server/utils/inbound-mail.js';

const FORWARDS = 'support@code-zero.dev=owner@example.net';

function harness(options: { readonly to: string; readonly forwardFails?: boolean }) {
  const forward = vi.fn<(destination: string) => Promise<void>>(() =>
    options.forwardFails
      ? Promise.reject(new Error('owner@example.net is not verified'))
      : Promise.resolve(),
  );
  const setReject = vi.fn<(reason: string) => void>();
  const lines: string[] = [];
  const log = {
    info: (line: string) => lines.push(line),
    error: (line: string) => lines.push(line),
  };
  return { forward, setReject, lines, log, message: { to: options.to, forward, setReject } };
}

describe('settleInboundMail', () => {
  it('forwards mail for a configured alias and refuses nothing', async () => {
    const { message, forward, setReject, log } = harness({ to: 'support@code-zero.dev' });

    await settleInboundMail(message, FORWARDS, log);

    expect(forward).toHaveBeenCalledExactlyOnceWith('owner@example.net');
    expect(setReject).not.toHaveBeenCalled();
  });

  it('refuses mail for an address that is not configured', async () => {
    const { message, forward, setReject, log } = harness({ to: 'nobody@code-zero.dev' });

    await settleInboundMail(message, FORWARDS, log);

    expect(setReject).toHaveBeenCalledExactlyOnceWith('No such recipient');
    expect(forward).not.toHaveBeenCalled();
  });

  it('refuses everything while nothing is configured', async () => {
    const { message, forward, setReject, log } = harness({ to: 'support@code-zero.dev' });

    await settleInboundMail(message, undefined, log);

    expect(setReject).toHaveBeenCalledOnce();
    expect(forward).not.toHaveBeenCalled();
  });

  it('settles the message when the configuration is malformed, without naming it to the sender', async () => {
    const { message, forward, setReject, log, lines } = harness({ to: 'support@code-zero.dev' });

    await settleInboundMail(message, 'support@code-zero.dev=owner-without-domain', log);

    expect(forward).not.toHaveBeenCalled();
    expect(setReject).toHaveBeenCalledExactlyOnceWith('Delivery is temporarily unavailable');
    expect(lines.join('\n')).not.toContain('owner-without-domain');
  });

  it('refuses the message when forwarding fails rather than leaving it unsettled', async () => {
    const { message, setReject, log, lines } = harness({
      to: 'support@code-zero.dev',
      forwardFails: true,
    });

    await settleInboundMail(message, FORWARDS, log);

    expect(setReject).toHaveBeenCalledExactlyOnceWith('Delivery failed');
    // The runtime's error quotes the destination; the log must not.
    expect(lines.join('\n')).not.toContain('owner@example.net');
  });

  it('never logs the destination address on success', async () => {
    const { message, log, lines } = harness({ to: 'support@code-zero.dev' });

    await settleInboundMail(message, FORWARDS, log);

    expect(lines).toEqual(['[mail] forwarded inbound mail for support@code-zero.dev']);
  });
});

describe('stringVariable', () => {
  it('reads a string variable from the Worker environment', () => {
    expect(stringVariable({ MAIL_INBOUND_FORWARDS: 'a=b' }, 'MAIL_INBOUND_FORWARDS')).toBe('a=b');
  });

  it('answers nothing for a missing or non-string value', () => {
    expect(stringVariable(undefined, 'X')).toBeUndefined();
    expect(stringVariable({}, 'X')).toBeUndefined();
    expect(stringVariable({ X: 1 }, 'X')).toBeUndefined();
  });
});
