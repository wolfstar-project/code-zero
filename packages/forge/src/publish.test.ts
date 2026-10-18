import { describe, expect, it } from 'vitest';

import type { ChangeRequestRef } from './contracts.js';
import { publishOutcome } from './publish.js';
import { createForgeRegistry } from './registry.js';
import { reviewBundle } from './test-support/evidence.js';
import { fakeChangeRequest, fakeForge, fakeRegistry } from './test-support/fake-forge.js';
import { HEAD, TOKEN, type ForgeFixture } from './test-support/forge-fixture.js';
import { forgeFixtures } from './test-support/forges/index.js';
import { statusEcho } from './test-support/status-echo.js';

function target(fixture: ForgeFixture): ChangeRequestRef {
  return {
    forge: fixture.kind,
    instance: fixture.instance,
    owner: fixture.owner,
    repo: 'app',
    number: 7,
    headSha: HEAD,
  };
}

function echoRegistry(fixture: ForgeFixture) {
  const echo = statusEcho(fixture.kind);
  return { ...echo, registry: createForgeRegistry([fixture.connection], { fetch: echo.fetch }) };
}

// The only forge whose commit statuses have a state for "neither passed nor failed".
const nativeNeutral = new Set(['azure-devops']);

describe.each(forgeFixtures)('publishOutcome on $kind', (fixture) => {
  it('reports a verified run as success without degradation', async () => {
    const { registry, requests } = echoRegistry(fixture);
    const publication = await publishOutcome(registry, target(fixture), reviewBundle());
    expect(publication).toMatchObject({ outcome: 'success', surface: 'commit-status' });
    expect(publication.degraded).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('POST');
  });

  it('sends the credential only as an Authorization header', async () => {
    const { registry, requests } = echoRegistry(fixture);
    await publishOutcome(registry, target(fixture), reviewBundle());
    for (const request of requests) {
      expect(request.authorization).not.toBeNull();
      expect(request.url + request.body).not.toContain(TOKEN);
    }
  });

  it('never presents a failed verification as success', async () => {
    const { registry } = echoRegistry(fixture);
    const failed = await publishOutcome(
      registry,
      target(fixture),
      reviewBundle({
        state: 'failed',
        verified: false,
        checks: [{ command: 'test', exitCode: 1, stdout: '', stderr: '', durationMs: 1 }],
      }),
    );
    expect(failed.outcome).toBe('failure');
    // Every forge has a native failure state.
    expect(failed.degraded).toBeUndefined();
  });

  const neutralRun = reviewBundle({ verified: false });

  it.skipIf(nativeNeutral.has(fixture.kind))(
    'degrades a neutral outcome explicitly, since the forge has no neutral state',
    async () => {
      const { registry } = echoRegistry(fixture);
      const neutral = await publishOutcome(registry, target(fixture), neutralRun);
      expect(neutral.outcome).toBe('neutral');
      expect(neutral.degraded).toContain('for a neutral outcome');
    },
  );

  it.runIf(nativeNeutral.has(fixture.kind))('reports a neutral outcome natively', async () => {
    const { registry } = echoRegistry(fixture);
    const neutral = await publishOutcome(registry, target(fixture), neutralRun);
    expect(neutral).toMatchObject({ outcome: 'neutral', state: 'notApplicable' });
    expect(neutral.degraded).toBeUndefined();
  });

  it('always degrades action-required to a blocking failure', async () => {
    const { registry } = echoRegistry(fixture);
    const waiting = await publishOutcome(
      registry,
      target(fixture),
      reviewBundle({ state: 'needs-human', verified: false }),
    );
    expect(waiting.outcome).toBe('action-required');
    expect(waiting.degraded).toContain('no action-required state');
  });

  it('falls back to a status comment when the connection cannot report statuses', async () => {
    const factory = fakeForge(fixture, { support: { 'checks.report': false } });
    const publication = await publishOutcome(
      fakeRegistry(factory, fixture.kind),
      fakeChangeRequest(fixture),
      reviewBundle(),
    );
    expect(publication).toMatchObject({ outcome: 'success', surface: 'comment' });
    expect(publication.degraded).toContain('posted as a comment');
    const thread = factory.store.repos.get('acme/app')?.threads.get('7');
    expect(thread?.comments).toHaveLength(1);
  });

  it('reports nothing, and says so, when the connection can neither report nor comment', async () => {
    const factory = fakeForge(fixture, { readOnly: true });
    const publication = await publishOutcome(
      fakeRegistry(factory, fixture.kind),
      fakeChangeRequest(fixture),
      reviewBundle(),
    );
    expect(publication).toMatchObject({ surface: 'none', state: 'unreported' });
    expect(publication.degraded).toBeDefined();
  });
});

describe('publishOutcome', () => {
  it('keeps credentials out of the status description and bounds it', async () => {
    const [fixture] = forgeFixtures;
    if (!fixture) throw new Error('missing fixture');
    const { registry, requests } = echoRegistry(fixture);
    await publishOutcome(
      registry,
      target(fixture),
      reviewBundle({ summary: `leaked ghp_${'x'.repeat(36)} ${'y'.repeat(400)}` }),
      { name: 'Code Zero (staging)', detailsUrl: 'https://cz.example/tasks/cz_test' },
    );
    const sent: unknown = JSON.parse(requests[0]?.body ?? '{}');
    expect(sent).toMatchObject({
      context: 'Code Zero (staging)',
      target_url: 'https://cz.example/tasks/cz_test',
    });
    expect(requests[0]?.body).not.toContain('ghp_');
  });

  it('refuses a change request on a forge with no connection', async () => {
    const [fixture] = forgeFixtures;
    if (!fixture) throw new Error('missing fixture');
    const { registry } = echoRegistry(fixture);
    await expect(
      publishOutcome(registry, { ...target(fixture), instance: 'ghe.example.com' }, reviewBundle()),
    ).rejects.toThrow('no connection for ghe.example.com');
  });
});
