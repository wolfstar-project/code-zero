import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  credentialSummaries,
  credentialsPath,
  forgetCredential,
  normalizeOrigin,
  readCredentials,
  saveCredential,
} from './credentials.js';

const INVALID_URL_ERROR = /not a valid deployment url/i;
const PROTOCOL_ERROR = /must be http or https/i;
const MISSING_FILE_ERROR = /ENOENT/;

const CLOUD = 'https://cloud.example.test';
const SELF_HOSTED = 'https://zero.internal.test';

let directory: string;
let path: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'code-zero-credentials-'));
  path = join(directory, 'credentials.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('credentialsPath', () => {
  it('follows XDG_CONFIG_HOME when the operator set one', () => {
    expect(credentialsPath({ XDG_CONFIG_HOME: '/xdg' }, '/home/op')).toBe(
      '/xdg/code-zero/credentials.json',
    );
  });

  it('falls back to ~/.config, never to the working directory', () => {
    expect(credentialsPath({}, '/home/op')).toBe('/home/op/.config/code-zero/credentials.json');
    expect(credentialsPath({ XDG_CONFIG_HOME: '  ' }, '/home/op')).toBe(
      '/home/op/.config/code-zero/credentials.json',
    );
  });
});

describe('normalizeOrigin', () => {
  it('reduces a deployment URL to its origin so one host cannot occupy two entries', () => {
    expect(normalizeOrigin('https://cloud.example.test/')).toBe(CLOUD);
    expect(normalizeOrigin('https://cloud.example.test/device?user_code=x')).toBe(CLOUD);
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('refuses anything that is not an absolute http(s) URL', () => {
    expect(() => normalizeOrigin('cloud.example.test')).toThrow(INVALID_URL_ERROR);
    expect(() => normalizeOrigin('file:///etc/passwd')).toThrow(PROTOCOL_ERROR);
  });
});

describe('readCredentials', () => {
  it('treats an absent file as no stored sessions', async () => {
    await expect(readCredentials(path)).resolves.toEqual({});
  });

  it('treats a malformed or wrongly shaped file as empty rather than failing the command', async () => {
    await writeFile(path, 'not json', 'utf8');
    await expect(readCredentials(path)).resolves.toEqual({});

    await writeFile(path, '["array"]', 'utf8');
    await expect(readCredentials(path)).resolves.toEqual({});
  });

  it('drops entries missing a token or an expiry instead of returning half a credential', async () => {
    await writeFile(
      path,
      JSON.stringify({
        [CLOUD]: { accessToken: 'tok', expiresAt: '2026-01-01T00:00:00.000Z' },
        [SELF_HOSTED]: { accessToken: 'tok' },
      }),
      'utf8',
    );

    await expect(readCredentials(path)).resolves.toEqual({
      [CLOUD]: { accessToken: 'tok', expiresAt: '2026-01-01T00:00:00.000Z' },
    });
  });
});

describe('saveCredential', () => {
  it('keeps a cloud-managed and a self-hosted session side by side', async () => {
    await saveCredential(CLOUD, { accessToken: 'cloud', expiresAt: 'later' }, path);
    await saveCredential(SELF_HOSTED, { accessToken: 'self', expiresAt: 'later' }, path);

    await expect(readCredentials(path)).resolves.toEqual({
      [CLOUD]: { accessToken: 'cloud', expiresAt: 'later' },
      [SELF_HOSTED]: { accessToken: 'self', expiresAt: 'later' },
    });
  });

  it('writes the token file readable by its owner alone', async () => {
    await saveCredential(CLOUD, { accessToken: 'cloud', expiresAt: 'later' }, path);

    // Masking to the permission bits: the file type bits are irrelevant and platform-specific.
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('tightens a file an earlier laxer umask created', async () => {
    await writeFile(path, '{}', { encoding: 'utf8', mode: 0o644 });
    await saveCredential(CLOUD, { accessToken: 'cloud', expiresAt: 'later' }, path);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('replaces a permissive file instead of writing the token through it', async () => {
    // The distinction the mode assertion above cannot make: writing in place would put the token
    // into a world-readable inode and only narrow it afterwards, leaving it readable for as long
    // as that took — and for good if the narrowing failed. A different inode proves the bytes
    // landed in a file that was owner-only from creation.
    await writeFile(path, '{}', { encoding: 'utf8', mode: 0o666 });
    const before = await stat(path);

    await saveCredential(CLOUD, { accessToken: 'cloud', expiresAt: 'later' }, path);
    const after = await stat(path);

    expect(after.ino).not.toBe(before.ino);
    expect(after.mode & 0o777).toBe(0o600);
  });

  it('leaves no scratch file behind for another user to read', async () => {
    await saveCredential(CLOUD, { accessToken: 'cloud', expiresAt: 'later' }, path);

    expect((await readdir(directory)).toSorted()).toEqual(['credentials.json']);
  });
});

describe('forgetCredential', () => {
  it('forgets one deployment and leaves the others signed in', async () => {
    await saveCredential(CLOUD, { accessToken: 'cloud', expiresAt: 'later' }, path);
    await saveCredential(SELF_HOSTED, { accessToken: 'self', expiresAt: 'later' }, path);

    await expect(forgetCredential(CLOUD, path)).resolves.toBe(true);
    await expect(readCredentials(path)).resolves.toEqual({
      [SELF_HOSTED]: { accessToken: 'self', expiresAt: 'later' },
    });
  });

  it('removes the file once the last session is gone, leaving no empty husk behind', async () => {
    await saveCredential(CLOUD, { accessToken: 'cloud', expiresAt: 'later' }, path);

    await expect(forgetCredential(undefined, path)).resolves.toBe(true);
    await expect(readFile(path, 'utf8')).rejects.toThrow(MISSING_FILE_ERROR);
  });

  it('reports that nothing was forgotten rather than claiming a sign-out that did not happen', async () => {
    await expect(forgetCredential(CLOUD, path)).resolves.toBe(false);

    await saveCredential(SELF_HOSTED, { accessToken: 'self', expiresAt: 'later' }, path);
    await expect(forgetCredential(CLOUD, path)).resolves.toBe(false);
  });
});

describe('credentialSummaries', () => {
  const NOW = Date.parse('2026-08-19T12:00:00.000Z');

  it('reports each deployment and whether its token is still valid', async () => {
    await saveCredential(
      CLOUD,
      { accessToken: 'cloud', expiresAt: '2026-08-19T13:00:00.000Z' },
      path,
    );
    await saveCredential(
      SELF_HOSTED,
      { accessToken: 'self', expiresAt: '2026-08-19T11:00:00.000Z' },
      path,
    );

    await expect(credentialSummaries(path, NOW)).resolves.toEqual([
      { origin: CLOUD, expired: false },
      { origin: SELF_HOSTED, expired: true },
    ]);
  });

  it('never surfaces the token itself, because doctor output gets pasted into issues', async () => {
    await saveCredential(CLOUD, { accessToken: 'secret-token', expiresAt: 'later' }, path);

    expect(JSON.stringify(await credentialSummaries(path, NOW))).not.toContain('secret-token');
  });

  it('treats an unparseable expiry as expired rather than as still valid', async () => {
    await saveCredential(CLOUD, { accessToken: 'cloud', expiresAt: 'not-a-date' }, path);

    await expect(credentialSummaries(path, NOW)).resolves.toEqual([
      { origin: CLOUD, expired: true },
    ]);
  });

  it('reports nothing when no deployment has been signed into', async () => {
    await expect(credentialSummaries(path, NOW)).resolves.toEqual([]);
  });
});
