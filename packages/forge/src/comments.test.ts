import { describe, expect, it } from 'vitest';

import {
  publishEvidenceComment,
  publishIssueValidationComment,
  upsertProgressComment,
} from './comments.js';
import { issueBundle, reviewBundle } from './test-support/evidence.js';
import { fakeChangeRequest, fakeForge, fakeRegistry } from './test-support/fake-forge.js';
import { forgeFixtures } from './test-support/forges/index.js';

describe.each(forgeFixtures)('comments on $kind', (fixture) => {
  it('edits one progress comment instead of stacking new ones', async () => {
    const factory = fakeForge(fixture);
    const registry = fakeRegistry(factory, fixture.kind);
    const first = await upsertProgressComment(registry, fakeChangeRequest(fixture), 'Validating…');
    const second = await upsertProgressComment(registry, fakeChangeRequest(fixture), 'Verifying…');
    expect(first.status).toBe('created');
    expect(second.status).toBe('updated');
    const comments = factory.store.repos.get('acme/app')?.threads.get('7')?.comments ?? [];
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain('Verifying…');
  });

  it('adds a new comment, and says so, where comments cannot be edited', async () => {
    const factory = fakeForge(fixture, { support: { 'threads.editComment': false } });
    const publication = await upsertProgressComment(
      fakeRegistry(factory, fixture.kind),
      fakeChangeRequest(fixture),
      'Validating…',
    );
    expect(publication).toMatchObject({
      status: 'created',
      degraded: expect.stringContaining('new one'),
    });
  });

  it('publishes redacted evidence', async () => {
    const factory = fakeForge(fixture);
    const leaked = `ghp_${'x'.repeat(36)}`;
    await publishEvidenceComment(
      fakeRegistry(factory, fixture.kind),
      fakeChangeRequest(fixture),
      reviewBundle({ summary: `Reviewed with ${leaked}` }),
    );
    const [comment] = factory.store.repos.get('acme/app')?.threads.get('7')?.comments ?? [];
    expect(comment?.body).toContain('Reviewed with');
    expect(comment?.body).not.toContain(leaked);
  });

  const issueTarget = {
    forge: fixture.kind,
    instance: fixture.instance,
    issue: { owner: 'acme', repo: 'app', number: 9 },
  };

  it.runIf(fixture.issue !== undefined)('reports an issue verdict on the issue', async () => {
    const factory = fakeForge(fixture);
    const publication = await publishIssueValidationComment(
      fakeRegistry(factory, fixture.kind),
      issueTarget,
      issueBundle,
    );
    expect(publication.status).toBe('created');
    const [comment] = factory.store.repos.get('acme/app')?.threads.get('9')?.comments ?? [];
    expect(comment?.body).toContain('**Confirmed.**');
  });

  it.skipIf(fixture.issue !== undefined)('cannot report on a forge without issues', async () => {
    const publication = await publishIssueValidationComment(
      fakeRegistry(fakeForge(fixture), fixture.kind),
      issueTarget,
      issueBundle,
    );
    expect(publication.status).toBe('unsupported');
  });
});

describe('publishIssueValidationComment', () => {
  it('posts nothing for a run that failed before reaching a verdict', async () => {
    const [fixture] = forgeFixtures;
    if (!fixture) throw new Error('missing fixture');
    const factory = fakeForge(fixture);
    const publication = await publishIssueValidationComment(
      fakeRegistry(factory, fixture.kind),
      {
        forge: fixture.kind,
        instance: fixture.instance,
        issue: { owner: 'acme', repo: 'app', number: 9 },
      },
      { ...issueBundle, state: 'failed' },
    );
    expect(publication.status).toBe('skipped');
    expect(factory.store.repos.get('acme/app')?.threads.get('9')?.comments).toEqual([]);
  });
});
