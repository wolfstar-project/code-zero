import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * One deployment's stored session, as `zero login` leaves it.
 *
 * Only the bearer token and its expiry: everything else about the session belongs to the
 * deployment that minted it, and a stale local copy of a user's name or role would be a second
 * source of truth for authorization decisions this file has no business influencing.
 */
export interface StoredCredential {
  readonly accessToken: string;
  /** ISO 8601 instant the token stops being accepted, so a stale entry is recognisable offline. */
  readonly expiresAt: string;
}

/**
 * Every deployment the CLI holds a session for, keyed by origin.
 *
 * Keyed rather than singular because one workstation routinely drives a cloud-managed deployment
 * and a self-hosted one, and signing into the second must not silently evict the first.
 */
export type CredentialStore = Readonly<Record<string, StoredCredential>>;

/**
 * Narrows a parsed JSON value to something with readable properties.
 *
 * A type predicate rather than a cast: the file is operator-editable, so the one place it is read
 * should prove its shape instead of asserting it.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only the owner may read the token file; a shared workstation is the expected environment. */
const OWNER_ONLY = 0o600;
const DIRECTORY_OWNER_ONLY = 0o700;

/**
 * Where the credential file lives.
 *
 * Follows the XDG base-directory convention rather than writing beside the checkout: a token is a
 * property of the operator, not of the repository they happen to be standing in, and a file inside
 * a working tree is one `git add -A` away from being published.
 *
 * The environment is passed in so callers stay deterministic in tests.
 */
export function credentialsPath(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  const configHome = environment.XDG_CONFIG_HOME?.trim();
  return join(configHome || join(home, '.config'), 'code-zero', 'credentials.json');
}

/**
 * Normalize a deployment URL to the origin used as a store key.
 *
 * Without this, `https://app.example.test` and `https://app.example.test/` would occupy two
 * entries, and signing in through one would look like being signed out through the other.
 *
 * @throws when the value is not a parseable absolute URL, because the alternative is issuing a
 * device-code request against a silently wrong host.
 */
export function normalizeOrigin(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a valid deployment URL: ${url}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new Error(`Deployment URL must be http or https: ${url}`);
  return parsed.origin;
}

/**
 * Read the credential store, treating an absent or unreadable file as an empty one.
 *
 * A malformed file is also empty rather than fatal: the recovery for a corrupted token cache is to
 * sign in again, which is exactly what an empty store prompts, and refusing to run at all would
 * make an unrelated command fail for a reason it does not care about.
 */
export async function readCredentials(path = credentialsPath()): Promise<CredentialStore> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const store: Record<string, StoredCredential> = {};
    for (const [origin, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      const { accessToken, expiresAt } = value;
      if (typeof accessToken !== 'string' || typeof expiresAt !== 'string') continue;
      store[origin] = { accessToken, expiresAt };
    }
    return store;
  } catch {
    return {};
  }
}

/**
 * Summarise the stored sessions for `zero doctor`.
 *
 * Reports the origin and whether the token is still within its expiry, and deliberately never the
 * token itself: doctor's output is routinely pasted into an issue. An unparseable `expiresAt` is
 * reported expired rather than valid, so a corrupted entry reads as "sign in again".
 */
export async function credentialSummaries(
  path = credentialsPath(),
  now: number = Date.now(),
): Promise<readonly { origin: string; expired: boolean }[]> {
  const store = await readCredentials(path);
  return Object.entries(store)
    .map(([origin, credential]) => {
      const expiresAt = Date.parse(credential.expiresAt);
      return { origin, expired: Number.isNaN(expiresAt) || expiresAt <= now };
    })
    .toSorted((left, right) => left.origin.localeCompare(right.origin));
}

/**
 * Replace the credential file with `store`, atomically and without ever widening its permissions.
 *
 * `writeFile`'s `mode` only applies when it creates the file, so writing straight to an existing
 * world-readable `credentials.json` would publish every token in it for as long as it took a
 * follow-up `chmod` to run — and permanently if that `chmod` failed. Writing to a fresh
 * owner-only temporary file and renaming over the target closes that window: the bytes are never
 * readable by anyone else, and `rename` is atomic within a directory, so a concurrent reader sees
 * either the old file or the new one and never a half-written one.
 *
 * The temporary name carries the process id so two concurrent writers do not clobber each other's
 * scratch file. It does not make the surrounding read-modify-write atomic — two processes racing
 * to save different origins can still lose one entry — but that needs a lock file, and losing a
 * session to a race is recoverable by signing in again, whereas leaking one is not.
 */
async function writeStore(store: CredentialStore, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: DIRECTORY_OWNER_ONLY });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  // `wx` fails rather than truncating an existing file, so the mode below is always the mode the
  // file is created with rather than one inherited from something already there.
  const handle = await open(temporaryPath, 'wx', OWNER_ONLY);
  try {
    await handle.writeFile(`${JSON.stringify(store, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }

  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

/** Record a session for one deployment, leaving every other entry untouched. */
export async function saveCredential(
  origin: string,
  credential: StoredCredential,
  path = credentialsPath(),
): Promise<void> {
  const store = await readCredentials(path);
  await writeStore({ ...store, [origin]: credential }, path);
}

/**
 * Forget one deployment's session, or every one of them.
 *
 * Removing the last entry deletes the file rather than leaving an empty object behind, so
 * "signed out" is indistinguishable from "never signed in" on disk.
 *
 * @returns whether anything was actually removed, so the caller can tell the operator the
 * difference between forgetting a session and having none to forget.
 */
export async function forgetCredential(
  origin: string | undefined,
  path = credentialsPath(),
): Promise<boolean> {
  const store = await readCredentials(path);
  const origins = origin === undefined ? Object.keys(store) : [origin];
  const remaining = Object.fromEntries(
    Object.entries(store).filter(([key]) => !origins.includes(key)),
  );
  if (Object.keys(remaining).length === Object.keys(store).length) return false;

  if (Object.keys(remaining).length === 0) {
    await rm(path, { force: true });
    return true;
  }

  await writeStore(remaining, path);
  return true;
}
