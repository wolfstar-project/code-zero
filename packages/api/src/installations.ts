import type { OrganizationMembership } from './settings.js';

/**
 * What the control plane needs from the source-control provider when an organization connects its
 * code: where to send a person to install the app, proof that they control what they claim to have
 * installed, and what an installation can see.
 *
 * Declared here, not imported from `@code-zero/forge`, for the reason `RepositoryAdmin` is: this
 * package composes adapters into the API and does not talk to a provider itself. `apps/web` backs
 * it with the provider; a test backs it with a fake.
 */
export interface InstallationProvider {
  /** The page the person is sent to in order to install the app, carrying the signed state. */
  installUrl(state: string): string;
  /**
   * Prove that the person who completed the install flow controls `installationId`, and return the
   * account it is installed on.
   *
   * `userCode` is the authorization code the provider sent back with them. The installation id alone
   * proves nothing: it arrives in a query string, so anyone can write any id into it.
   *
   * Throws {@link InstallationVerificationError} when the claim cannot be confirmed, and any other
   * error when the provider could not be asked.
   */
  verify(input: { installationId: string; userCode: string }): Promise<InstalledAccount>;
  /** Every repository the installation can currently see, with the provider's own coordinates. */
  repositories(installationId: string): Promise<VisibleRepository[]>;
}

/** The account an installation is installed on. */
export interface InstalledAccount {
  login: string;
  type: string;
}

/** A repository an installation can see. */
export interface VisibleRepository {
  externalId: string;
  owner: string;
  name: string;
  private: boolean;
  archived: boolean;
}

/** The provider says this person does not control this installation. */
export class InstallationVerificationError extends Error {
  constructor() {
    super('The installation could not be verified for this account');
    this.name = 'InstallationVerificationError';
  }
}

/** An installation attached to an organization, as the API returns it. */
export interface InstallationView {
  id: string;
  provider: string;
  externalId: string;
  accountLogin: string;
  accountType: string;
  suspended: boolean;
}

/** A repository an organization selected. */
export interface SelectedRepositoryView {
  id: string;
  installationId: string;
  provider: string;
  owner: string;
  name: string;
  mode: 'observe' | 'suggest';
}

/** One repository to select, named by the provider's id and nothing else. */
export interface RepositoryChoice {
  externalId: string;
  mode?: 'observe' | 'suggest' | undefined;
}

/**
 * The installations and selected repositories a deployment's store keeps.
 *
 * Membership is read here, as `OrganizationSettingsStore` does, because a session remembers the
 * organization it last acted in and not whether its account still belongs there.
 */
export interface InstallationStore {
  membership(organizationId: string, userId: string): Promise<OrganizationMembership | null>;
  /** `taken` when another organization already holds the installation. */
  attach(input: {
    organizationId: string;
    externalId: string;
    accountLogin: string;
    accountType: string;
    createdByUserId: string;
  }): Promise<{ ok: true; installation: InstallationView } | { ok: false; reason: 'taken' }>;
  list(organizationId: string): Promise<InstallationView[]>;
  /** The installation, only if it belongs to this organization. */
  find(organizationId: string, installationId: string): Promise<InstallationView | null>;
  select(input: {
    organizationId: string;
    installationId: string;
    repositories: readonly {
      externalId: string;
      owner: string;
      name: string;
      mode?: 'observe' | 'suggest' | undefined;
    }[];
  }): Promise<SelectedRepositoryView[]>;
  listRepositories(organizationId: string): Promise<SelectedRepositoryView[]>;
  removeRepository(organizationId: string, id: string): Promise<boolean>;
}

/** Everything the installation procedures need, handed over by the composition root. */
export interface InstallationService {
  readonly provider: InstallationProvider;
  readonly store: InstallationStore;
  readonly state: InstallationState;
}

/** The claims a state token carries. */
export interface InstallationStateClaims {
  userId: string;
  organizationId: string;
}

/**
 * Signs and checks the `state` that travels to the provider and back during installation.
 *
 * It binds the round trip to one person and one organization, so a callback cannot be replayed for
 * someone else or attached to another organization, and it expires, so a link found in a history
 * file stops working. Replaying a valid one inside its window only attaches the same installation
 * again, which is a no-op.
 */
export interface InstallationState {
  sign(claims: InstallationStateClaims): Promise<string>;
  /** The claims, or null for anything that is not a valid, unexpired token from this secret. */
  verify(token: string): Promise<InstallationStateClaims | null>;
}

const STATE_LIFETIME_MS = 10 * 60 * 1000;
const MINIMUM_SECRET_LENGTH = 32;

export function createInstallationState(
  secret: string,
  now: () => number = Date.now,
): InstallationState {
  if (secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(`The state secret must be at least ${MINIMUM_SECRET_LENGTH} characters`);
  }
  const encoder = new TextEncoder();
  const key = globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

  return {
    async sign(claims) {
      const payload = toBase64Url(
        encoder.encode(JSON.stringify({ ...claims, exp: now() + STATE_LIFETIME_MS })),
      );
      const signature = await globalThis.crypto.subtle.sign(
        'HMAC',
        await key,
        encoder.encode(payload),
      );
      return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
    },
    async verify(token) {
      const parts = token.split('.');
      const [payload, signature] = parts;
      if (parts.length !== 2 || !payload || !signature) return null;
      const signatureBytes = fromBase64Url(signature);
      if (!signatureBytes) return null;
      const valid = await globalThis.crypto.subtle.verify(
        'HMAC',
        await key,
        signatureBytes,
        encoder.encode(payload),
      );
      if (!valid) return null;
      return claimsFrom(payload, now());
    },
  };
}

function claimsFrom(payload: string, at: number): InstallationStateClaims | null {
  const bytes = fromBase64Url(payload);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const userId = 'userId' in parsed ? parsed.userId : undefined;
  const organizationId = 'organizationId' in parsed ? parsed.organizationId : undefined;
  const exp = 'exp' in parsed ? parsed.exp : undefined;
  if (typeof userId !== 'string' || typeof organizationId !== 'string') return null;
  if (typeof exp !== 'number' || exp <= at) return null;
  return { userId, organizationId };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
  } catch {
    return null;
  }
}
