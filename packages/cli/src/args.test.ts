import { describe, expect, it } from 'vitest';

import { parseCliArguments } from './args.js';

describe('parseCliArguments', () => {
  it('parses typed flags and equals syntax', () => {
    expect(parseCliArguments(['review', '--feedback=check this', '--json'])).toEqual({
      command: 'review',
      feedback: 'check this',
      help: false,
      json: true,
      proactive: false,
      remote: false,
      version: false,
    });
  });

  it('supports help and version aliases', () => {
    expect(parseCliArguments(['-h']).help).toBe(true);
    expect(parseCliArguments(['-v']).version).toBe(true);
  });

  it('defaults to the help command', () => {
    expect(parseCliArguments([]).command).toBe('help');
  });

  it('rejects unknown options and extra positionals', () => {
    expect(() => parseCliArguments(['doctor', '--wat'])).toThrow('Unknown option: --wat');
    expect(() => parseCliArguments(['doctor', 'extra'])).toThrow(
      'Unexpected positional argument: extra',
    );
  });

  it('restricts command-specific options', () => {
    expect(() => parseCliArguments(['init', '--json'])).toThrow('--json is only valid');
    expect(() => parseCliArguments(['doctor', '--feedback', 'text'])).toThrow(
      '--feedback is only valid',
    );
    expect(() => parseCliArguments(['doctor', '--proactive'])).toThrow('--proactive is only valid');
    expect(() => parseCliArguments(['doctor', '--url', 'https://zero.test'])).toThrow(
      '--url is only valid',
    );
    expect(() => parseCliArguments(['review', '--proactive', '--feedback', 'text'])).toThrow(
      'cannot be combined',
    );
  });

  it('accepts a deployment origin for the session commands', () => {
    expect(parseCliArguments(['login', '--url', 'https://zero.test'])).toMatchObject({
      command: 'login',
      url: 'https://zero.test',
    });
    expect(parseCliArguments(['logout', '--url', 'https://zero.test'])).toMatchObject({
      command: 'logout',
      url: 'https://zero.test',
    });
  });

  it('leaves the origin unset so login can resolve it from the environment', () => {
    expect(parseCliArguments(['login']).url).toBeUndefined();
    expect(parseCliArguments(['login', '--url', '  ']).url).toBeUndefined();
  });

  it('supports proactive diff review without reviewer feedback', () => {
    const parsed = parseCliArguments(['review', '--proactive']);
    expect(parsed).toMatchObject({
      command: 'review',
      proactive: true,
    });
    expect(parsed.feedback).toBeUndefined();
  });
});

describe('parseCliArguments --remote', () => {
  it('accepts a remote run and the deployment it names', () => {
    expect(
      parseCliArguments(['run', '--proactive', '--remote', '--url', 'https://zero.example.com']),
    ).toMatchObject({
      command: 'run',
      remote: true,
      url: 'https://zero.example.com',
    });
  });

  it('defaults to running in this checkout', () => {
    expect(parseCliArguments(['run', '--proactive']).remote).toBe(false);
  });

  it('refuses --remote on a command that runs no agent', () => {
    expect(() => parseCliArguments(['doctor', '--remote'])).toThrow(
      '--remote is only valid with review, fix, or run',
    );
  });

  it('still refuses --url on a local run, where it would select nothing', () => {
    expect(() =>
      parseCliArguments(['run', '--proactive', '--url', 'https://zero.example.com']),
    ).toThrow('--url is only valid with login, logout, or a --remote run');
  });
});
