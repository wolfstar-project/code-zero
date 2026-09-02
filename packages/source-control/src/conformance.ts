import type { EvidenceBundle } from '@code-zero/shared';

import type {
  SourceControlProvider,
  StatusPublisherOptions,
  WebhookDelivery,
} from './contracts.js';
import { reviewInputFromEvent } from './input.js';
import { COMMIT_SHA, MAX_BODY } from './untrusted.js';

/**
 * The fixtures one adapter supplies to the conformance suite.
 *
 * Fixtures are authentic deliveries: headers and body exactly as the provider would send them,
 * signed or tokened with `secret`. The suite derives every negative case (forged signature,
 * tampered body, ignored author, junk payload) from these, so an adapter cannot pass by special-
 * casing the happy path.
 */
export interface ProviderConformanceFixtures {
  secret: string;
  /** An authenticated delivery that must parse into a proactive review. */
  proactive: WebhookDelivery;
  /** An authenticated delivery that must parse into reviewer feedback. */
  feedback: WebhookDelivery;
  /** The author of `feedback`, for the self-ignore check. */
  feedbackAuthor: string;
  /** A delivery carrying an approval or another claim-free event, which must parse to null. */
  claimFree?: WebhookDelivery;
  /** Publisher options wired to an injected fetch, so no test touches the network. */
  statusOptions: (fetch: typeof globalThis.fetch) => StatusPublisherOptions;
  /** Every status request must address this URL prefix. */
  statusUrlPrefix: string;
}

export interface ConformanceCase {
  name: string;
  run: (provider: SourceControlProvider, fixtures: ProviderConformanceFixtures) => Promise<void>;
}

function ok(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parsed(provider: SourceControlProvider, delivery: WebhookDelivery) {
  const event = provider.eventName(delivery.headers);
  ok(event !== undefined, 'eventName must identify the fixture delivery');
  return provider.parseReviewEvent(event, JSON.parse(delivery.body));
}

function evidence(overrides: Partial<EvidenceBundle>): EvidenceBundle {
  return {
    taskId: 'cz_conformance',
    state: 'completed',
    verdict: 'accepted',
    verified: true,
    mode: 'observe',
    trigger: 'feedback',
    source: null,
    issue: null,
    runner: { kind: 'local', isolated: false, writable: false, network: 'none' },
    finding: null,
    plan: [],
    acceptanceCriteria: [],
    changedFiles: [],
    checks: [{ command: 'test', exitCode: 0, stdout: '', stderr: '', durationMs: 1 }],
    attempts: 1,
    transitions: [],
    summary: 'conformance summary',
    ...overrides,
  };
}

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

function requestUrl(url: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof url === 'string') return url;
  return url instanceof URL ? url.href : url.url;
}

function recordingFetch(): { fetch: typeof globalThis.fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    requests.push({ url: requestUrl(url), init });
    return new Response(JSON.stringify({ id: 1 }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, requests };
}

/**
 * The behavior every provider adapter must exhibit.
 *
 * The cases are framework-free and throw on violation, so any test runner (and any out-of-tree
 * adapter) can execute them unchanged.
 */
export const conformanceCases: readonly ConformanceCase[] = [
  {
    name: 'declares coherent capabilities',
    run: async (provider) => {
      const c = provider.capabilities;
      ok(
        c.changeRequestNoun === 'pull request' || c.changeRequestNoun === 'merge request',
        'changeRequestNoun must be a known noun',
      );
      ok(
        ['check-runs', 'commit-status', 'build-status'].includes(c.statusReporting),
        'statusReporting must be a known surface',
      );
    },
  },
  {
    name: 'recognizes its own deliveries and nothing anonymous',
    run: async (provider, fixtures) => {
      ok(provider.recognizes(fixtures.proactive.headers), 'must recognize its proactive fixture');
      ok(provider.recognizes(fixtures.feedback.headers), 'must recognize its feedback fixture');
      ok(!provider.recognizes({}), 'must not claim a delivery with no headers');
    },
  },
  {
    name: 'authenticates deliveries and rejects forgeries',
    run: async (provider, fixtures) => {
      for (const delivery of [fixtures.proactive, fixtures.feedback]) {
        ok(provider.verifyWebhook(delivery, fixtures.secret), 'must accept an authentic delivery');
        ok(
          !provider.verifyWebhook(delivery, `${fixtures.secret}-wrong`),
          'must reject the wrong secret',
        );
        ok(!provider.verifyWebhook(delivery, ''), 'must reject an empty secret');
        ok(
          !provider.verifyWebhook({ body: delivery.body, headers: {} }, fixtures.secret),
          'must reject a delivery with no credentials',
        );
        if (provider.capabilities.webhookAuthentication === 'hmac-sha256') {
          ok(
            !provider.verifyWebhook(
              { body: `${delivery.body} `, headers: delivery.headers },
              fixtures.secret,
            ),
            'must reject a tampered body',
          );
        }
      }
    },
  },
  {
    name: 'parses a proactive delivery into a diff-triggered review',
    run: async (provider, fixtures) => {
      const event = parsed(provider, fixtures.proactive);
      ok(event !== null, 'proactive fixture must parse');
      ok(event.trigger === 'proactive', 'trigger must be proactive');
      ok(event.items.length === 0, 'a proactive review must not invent feedback');
      ok(!event.requestedChanges, 'a proactive review carries no change request');
      assertRef(provider, event.changeRequest);
    },
  },
  {
    name: 'parses a feedback delivery into bounded, attributed items',
    run: async (provider, fixtures) => {
      const event = parsed(provider, fixtures.feedback);
      ok(event !== null, 'feedback fixture must parse');
      ok(event.trigger === 'feedback', 'trigger must be feedback');
      ok(event.items.length > 0, 'feedback must carry at least one item');
      for (const item of event.items) {
        ok(item.id.length > 0, 'items must be identifiable');
        ok(item.body.length > 0 && item.body.length <= MAX_BODY, 'bodies must be bounded');
        ok(item.author === fixtures.feedbackAuthor, 'the author must be preserved');
        if (item.requestedChanges)
          ok(
            provider.capabilities.changeRequests,
            'requestedChanges requires the changeRequests capability',
          );
      }
      assertRef(provider, event.changeRequest);
    },
  },
  {
    name: 'ignores its own account so a run cannot answer itself',
    run: async (provider, fixtures) => {
      const event = provider.eventName(fixtures.feedback.headers);
      ok(event !== undefined, 'eventName must identify the fixture delivery');
      const result = provider.parseReviewEvent(event, JSON.parse(fixtures.feedback.body), {
        ignoreAuthors: [fixtures.feedbackAuthor.toUpperCase()],
      });
      ok(result === null, 'an ignored author must produce nothing');
    },
  },
  {
    name: 'produces nothing for a claim-free event',
    run: async (provider, fixtures) => {
      if (!fixtures.claimFree) return;
      ok(
        parsed(provider, fixtures.claimFree) === null,
        'an approval or claim-free event must parse to null',
      );
    },
  },
  {
    name: 'rejects junk payloads instead of throwing',
    run: async (provider, fixtures) => {
      const event = provider.eventName(fixtures.feedback.headers) ?? 'unknown';
      for (const junk of [null, undefined, 42, 'text', [], {}, { action: 'created' }]) {
        ok(provider.parseReviewEvent(event, junk) === null, 'junk payloads must parse to null');
      }
      ok(
        provider.parseReviewEvent('no-such-event', JSON.parse(fixtures.feedback.body)) === null,
        'unknown events must parse to null',
      );
    },
  },
  {
    name: 'builds observe-mode runtime input by default',
    run: async (provider, fixtures) => {
      const event = parsed(provider, fixtures.feedback);
      ok(event !== null, 'feedback fixture must parse');
      const input = reviewInputFromEvent(event, { checkoutPath: '/checkout' });
      ok(input.mode === 'observe', 'a webhook must never escalate its own mode');
      ok(
        input.source?.startsWith(`${provider.kind}:`) === true,
        'the source label must be provider-qualified',
      );
      if (provider.capabilities.diffBase)
        ok(input.pullRequest !== undefined, 'diffBase providers must supply a full reference');
      else
        ok(
          input.pullRequest === undefined,
          'a partial diff reference must not masquerade as complete',
        );
    },
  },
  {
    name: 'publishes statuses without leaking the credential',
    run: async (provider, fixtures) => {
      const { fetch, requests } = recordingFetch();
      const options = fixtures.statusOptions(fetch);
      const publisher = provider.statusPublisher(options);
      const publication = await publisher.publish(
        (parsed(provider, fixtures.proactive) ?? assertNever()).changeRequest,
        evidence({}),
      );
      ok(publication.outcome === 'success', 'a verified run must publish success');
      ok(publication.state.length > 0, 'the provider-native state must be reported');
      ok(publication.degraded === undefined, 'success must never be degraded');
      ok(requests.length > 0, 'a publication must send a request');
      for (const request of requests) {
        ok(
          request.url.startsWith(fixtures.statusUrlPrefix),
          `unexpected status URL ${request.url}`,
        );
        const headers = new Headers(request.init?.headers);
        ok(
          headers.get('authorization')?.includes(options.token) === true,
          'the token must travel as an Authorization header',
        );
        const body = typeof request.init?.body === 'string' ? request.init.body : '';
        const visible = request.url + body;
        ok(!visible.includes(options.token), 'the token must not appear outside the header');
      }
    },
  },
  {
    name: 'degrades unsupported status conclusions explicitly',
    run: async (provider, fixtures) => {
      const { fetch } = recordingFetch();
      const publisher = provider.statusPublisher(fixtures.statusOptions(fetch));
      const target = (parsed(provider, fixtures.proactive) ?? assertNever()).changeRequest;

      const neutral = await publisher.publish(target, evidence({ verified: false }));
      ok(neutral.outcome === 'neutral', 'an unverified clean run is neutral');
      if (provider.capabilities.neutralStatus)
        ok(neutral.degraded === undefined, 'native neutral must not be degraded');
      else ok(neutral.degraded !== undefined, 'a mapped neutral must say it was mapped');

      const needsHuman = await publisher.publish(
        target,
        evidence({ state: 'needs-human', verified: false }),
      );
      ok(needsHuman.outcome === 'action-required', 'needs-human is action-required');
      if (provider.capabilities.actionRequiredStatus)
        ok(needsHuman.degraded === undefined, 'native action-required must not be degraded');
      else ok(needsHuman.degraded !== undefined, 'a mapped action-required must say it was mapped');

      const failed = await publisher.publish(
        target,
        evidence({
          state: 'failed',
          verified: false,
          checks: [{ command: 'test', exitCode: 1, stdout: '', stderr: '', durationMs: 1 }],
        }),
      );
      ok(failed.outcome === 'failure', 'a failed run is a failure');
      ok(failed.degraded === undefined, 'every provider has a native failure state');
    },
  },
];

function assertRef(
  provider: SourceControlProvider,
  ref: { owner: string; repo: string; number: number; headSha: string; baseSha?: string },
): void {
  ok(ref.owner.length > 0 && ref.repo.length > 0, 'the reference must name a repository');
  ok(Number.isInteger(ref.number) && ref.number > 0, 'the reference must carry a number');
  ok(COMMIT_SHA.test(ref.headSha), 'the head commit must look like a commit');
  if (provider.capabilities.diffBase)
    ok(ref.baseSha !== undefined && COMMIT_SHA.test(ref.baseSha), 'diffBase promises a base');
  else ok(ref.baseSha === undefined, 'a provider without diffBase must not invent a base');
}

function assertNever(): never {
  throw new Error('the proactive fixture must parse');
}
