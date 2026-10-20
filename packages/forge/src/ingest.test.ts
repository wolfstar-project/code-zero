import { describe, expect, it } from 'vitest';

import { ingestDelivery, type IngestOutcome } from './ingest.js';
import { createForgeRegistry } from './registry.js';
import {
  HEAD,
  replayRegistry,
  SECRET,
  signedDelivery,
  type ForgeFixture,
  type PayloadCase,
} from './test-support/forge-fixture.js';
import { forgeFixtures } from './test-support/forges/index.js';

function ingested(outcome: IngestOutcome) {
  if (outcome.status !== 'ingested') throw new Error(`expected ingested, got ${outcome.reason}`);
  return outcome;
}

async function ingest(
  fixture: ForgeFixture,
  delivery: PayloadCase,
  options: Parameters<typeof ingestDelivery>[3] = {},
) {
  const { registry, calls } = replayRegistry(fixture);
  const outcome = await ingestDelivery(
    registry,
    fixture.kind,
    await signedDelivery(fixture, delivery),
    options,
  );
  return { outcome, calls };
}

describe.each(forgeFixtures)('ingestDelivery on $kind', (fixture) => {
  it('accepts an authentic delivery and rejects the wrong secret', async () => {
    const { registry } = replayRegistry(fixture);
    const forged = await signedDelivery(fixture, fixture.proactive, {
      secret: `${fixture.signingSecret}-wrong`,
    });
    await expect(ingestDelivery(registry, fixture.kind, forged)).resolves.toMatchObject({
      status: 'rejected',
      reason: 'invalid-signature',
    });
    const { outcome } = await ingest(fixture, fixture.proactive);
    expect(outcome.status).toBe('ingested');
  });

  it('rejects a delivery that carries no credentials', async () => {
    const { registry } = replayRegistry(fixture);
    const authentic = await signedDelivery(fixture, fixture.proactive);
    const outcome = await ingestDelivery(registry, fixture.kind, {
      headers: fixture.eventHeaders(fixture.proactive.event),
      body: authentic.body,
    });
    expect(outcome).toMatchObject({ status: 'rejected', reason: 'invalid-signature' });
  });

  it.runIf(fixture.signsBody)('rejects a tampered body', async () => {
    const { registry } = replayRegistry(fixture);
    const authentic = await signedDelivery(fixture, fixture.proactive);
    const outcome = await ingestDelivery(registry, fixture.kind, {
      headers: authentic.headers,
      body: `${String(authentic.body)} `,
    });
    expect(outcome).toMatchObject({ status: 'rejected', reason: 'invalid-signature' });
  });

  it('fails closed when the connection has an empty webhook secret', async () => {
    const registry = createForgeRegistry([{ ...fixture.connection, webhookSecret: '' }]);
    const outcome = await ingestDelivery(
      registry,
      fixture.kind,
      await signedDelivery(fixture, fixture.proactive),
    );
    expect(outcome).toMatchObject({ status: 'rejected', reason: 'invalid-signature' });
  });

  it('turns a new change request into a proactive review read from the forge', async () => {
    const { outcome } = await ingest(fixture, fixture.proactive);
    const { reviews, issues } = ingested(outcome);
    expect(issues).toEqual([]);
    expect(reviews).toHaveLength(1);
    const [review] = reviews;
    expect(review).toMatchObject({
      forge: fixture.kind,
      trigger: 'proactive',
      items: [],
      requestedChanges: false,
      changeRequest: {
        forge: fixture.kind,
        instance: fixture.instance,
        owner: fixture.owner,
        repo: 'app',
        number: 7,
      },
    });
    // The commits come from the forge's record, never from the delivery's say-so.
    expect(review?.changeRequest.headSha.startsWith('a'.repeat(12))).toBe(true);
    expect(review?.changeRequest.baseSha?.startsWith('b'.repeat(12))).toBe(true);
  });

  it.skipIf(fixture.feedbackText)('ignores feedback forges delivers without text', async () => {
    const result = ingested((await ingest(fixture, fixture.feedback)).outcome);
    expect(result.reviews).toEqual([]);
    expect(result.ignored[0]?.reason).toContain('without its text');
  });

  it.runIf(fixture.feedbackText)('turns reviewer feedback into attributed items', async () => {
    const { outcome } = await ingest(fixture, fixture.feedback);
    const [review] = ingested(outcome).reviews;
    expect(review).toMatchObject({
      trigger: 'feedback',
      requestedChanges: fixture.feedbackRequestsChanges,
      changeRequest: { number: 7, headSha: HEAD },
    });
    expect(review?.items).toHaveLength(1);
    expect(review?.items[0]).toMatchObject({
      author: fixture.feedbackAuthor,
      requestedChanges: fixture.feedbackRequestsChanges,
    });
    expect(review?.items[0]?.body.length).toBeGreaterThan(0);
  });

  it('ignores its own account, case-insensitively, so a run cannot answer itself', async () => {
    const { outcome, calls } = await ingest(fixture, fixture.feedback, {
      ignoreAuthors: [fixture.feedbackAuthor.toUpperCase()],
    });
    const result = ingested(outcome);
    expect(result.reviews).toEqual([]);
    expect(result.ignored[0]?.reason).toContain('ignored author');
    // An ignored delivery costs no API call.
    expect(calls).toEqual([]);
  });

  it('filters bot feedback only when bots are refused', async () => {
    const refused = ingested(
      (await ingest(fixture, fixture.botFeedback, { allowBots: false })).outcome,
    );
    expect(refused.reviews).toEqual([]);
    expect(refused.ignored[0]?.reason).toContain('is a bot');

    const allowed = ingested((await ingest(fixture, fixture.botFeedback)).outcome);
    expect(allowed.reviews.map((review) => review.trigger)).toEqual(
      fixture.feedbackText ? ['feedback'] : [],
    );
  });

  it('produces nothing for an event that carries no claim', async () => {
    const result = ingested((await ingest(fixture, fixture.claimFree)).outcome);
    expect(result.reviews).toEqual([]);
    expect(result.ignored).toHaveLength(1);
  });

  it('ignores issues unless policy enables them', async () => {
    const delivery = fixture.issue;
    if (!delivery) return;
    const disabled = ingested((await ingest(fixture, delivery)).outcome);
    expect(disabled.issues).toEqual([]);
    expect(disabled.ignored[0]?.reason).toBe('issue tasks are not enabled');
  });

  it.runIf(fixture.issue !== undefined)(
    'turns a labelled issue into an issue task read from the forge',
    async () => {
      const delivery = fixture.issue;
      if (!delivery) return;
      const result = ingested(
        (await ingest(fixture, delivery, { issues: { requireLabel: 'code-zero' } })).outcome,
      );
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        forge: fixture.kind,
        trigger: 'issue',
        instance: fixture.instance,
        issue: { owner: fixture.owner, number: 9 },
        title: 'The loader crashes',
        body: 'load() returns null and callers dereference it.',
      });

      const unlabelled = ingested(
        (await ingest(fixture, delivery, { issues: { requireLabel: 'triaged' } })).outcome,
      );
      expect(unlabelled.issues).toEqual([]);
      expect(unlabelled.ignored[0]?.reason).toContain('does not carry the triaged label');
    },
  );

  it('rejects a signed body that is not a delivery instead of throwing', async () => {
    const { registry } = replayRegistry(fixture);
    const outcome = await ingestDelivery(
      registry,
      fixture.kind,
      await signedDelivery(fixture, fixture.proactive, { body: 'not json' }),
    );
    expect(outcome).toMatchObject({ status: 'rejected', reason: 'malformed-delivery' });
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });
});

describe('ingestDelivery routing', () => {
  const [github] = forgeFixtures;

  it('rejects a forge with no connection, and a forge Code Zero does not connect to', async () => {
    if (!github) throw new Error('missing fixture');
    const { registry } = replayRegistry(github);
    const delivery = await signedDelivery(github, github.proactive);
    await expect(ingestDelivery(registry, 'gitlab', delivery)).resolves.toMatchObject({
      status: 'rejected',
      reason: 'unknown-forge',
    });
    await expect(ingestDelivery(registry, 'gitee', delivery)).resolves.toMatchObject({
      status: 'rejected',
      reason: 'unknown-forge',
    });
  });

  it('reads each change request once per delivery', async () => {
    if (!github) throw new Error('missing fixture');
    const { calls } = await ingest(github, github.proactive);
    const reads = calls.filter((call) => call.url.endsWith('/pulls/7'));
    expect(reads).toHaveLength(1);
  });
});
