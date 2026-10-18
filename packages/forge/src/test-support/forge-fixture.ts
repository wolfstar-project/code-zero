import { fixtureFetch, signDelivery, type Fixture, type FixtureCall } from 'forges/testing';

import type { ForgeConnection } from '../connections.js';
import type { ForgeKind } from '../contracts.js';
import type { WebhookDelivery } from '../ingest.js';
import { createForgeRegistry, type ForgeRegistry } from '../registry.js';

/** Long enough that redaction substitutes them wherever they could leak. */
export const TOKEN = 'tok_0123456789abcdef';
export const SECRET = 'whsec_0123456789abcdef';
export const HEAD = 'a'.repeat(40);
export const BASE = 'b'.repeat(40);

export interface PayloadCase {
  event: string;
  payload: Record<string, unknown>;
}

/**
 * Authentic deliveries and API responses for one forge.
 *
 * Every negative case (forged signature, tampered body, ignored author, missing label) is derived
 * from these, so a forge cannot pass by special-casing the happy path.
 */
export interface ForgeFixture {
  kind: ForgeKind;
  instance: string;
  owner: string;
  connection: ForgeConnection;
  /** What the forge signs with: the hook secret, or `user:password` for Azure DevOps. */
  signingSecret: string;
  /** Whether a changed body fails verification; GitLab and Azure DevOps compare a header instead. */
  signsBody: boolean;
  /** Headers that name the event and the delivery, beside the signature. */
  eventHeaders: (event: string) => Record<string, string>;
  /** A delivery that opens a change request. */
  proactive: PayloadCase;
  /** Reviewer feedback by `feedbackAuthor`. */
  feedback: PayloadCase;
  feedbackAuthor: string;
  /** False where `forges` 0.1 delivers the feedback without its text. */
  feedbackText: boolean;
  feedbackRequestsChanges: boolean;
  /** The same kind of feedback from an automation account. */
  botFeedback: PayloadCase;
  /** An approval or another event that carries no claim. */
  claimFree: PayloadCase;
  /** An issue labelled for Code Zero; absent on forges without issues. */
  issue?: PayloadCase;
  /** The forge's record of change request 7 and issue 9, as its API returns them. */
  api: Fixture[];
}

export function apiResponse(url: string, body: unknown): Fixture {
  return {
    request: { method: 'GET', url },
    response: { status: 200, headers: { 'content-type': 'application/json' }, body },
  };
}

/** A delivery exactly as the forge would send it, signed with `secret`. */
export async function signedDelivery(
  fixture: ForgeFixture,
  delivery: PayloadCase,
  options: { secret?: string; body?: string } = {},
): Promise<WebhookDelivery> {
  const body = options.body ?? JSON.stringify(delivery.payload);
  const headers = await signDelivery(
    fixture.kind,
    body,
    options.secret ?? fixture.signingSecret,
    fixture.eventHeaders(delivery.event),
  );
  return { headers, body };
}

/** A registry whose one connection answers from the fixture's recorded API responses. */
export function replayRegistry(fixture: ForgeFixture): {
  registry: ForgeRegistry;
  calls: FixtureCall[];
} {
  const replay = fixtureFetch(fixture.api);
  return {
    registry: createForgeRegistry([fixture.connection], { fetch: replay.fetch }),
    calls: replay.calls,
  };
}
