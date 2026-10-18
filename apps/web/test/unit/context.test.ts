import { MemoryTaskStore, accessFromEnvironment, type ApiKeyVerifier } from '@code-zero/api';
import { describe, expect, it } from 'vitest';

import { apiKeyVerifier, buildRpcContext } from '../../server/utils/context.js';

const repositories = {
  list: () => Promise.resolve([]),
  save: () => Promise.reject(new Error('unused')),
  remove: () => Promise.resolve(false),
  allows: () => Promise.resolve(false),
};

const verifier: ApiKeyVerifier = {
  verifyApiKey: () => Promise.resolve({ valid: false, key: null }),
};

function requestWith(authorization?: string): Request {
  return new Request('https://code-zero.example.test/api/v1/tasks', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe('buildRpcContext', () => {
  const access = accessFromEnvironment('ci:cz_operator-token');

  it('hands an unmatched prefixed bearer to the API-key verifier', () => {
    const context = buildRpcContext(
      requestWith('Bearer cz_organization-key'),
      access,
      new MemoryTaskStore(),
      repositories,
      { apiKeys: verifier },
    );

    expect(context.principal).toBeUndefined();
    expect(context.presentedApiKey).toBe('cz_organization-key');
    expect(context.apiKeys).toBe(verifier);
  });

  it('never sends an operator token to the key store, even one with the key prefix', () => {
    const context = buildRpcContext(
      requestWith('Bearer cz_operator-token'),
      access,
      new MemoryTaskStore(),
      repositories,
      { apiKeys: verifier },
    );

    expect(context.principal?.kind).toBe('token');
    expect(context.presentedApiKey).toBeUndefined();
  });

  it('ignores a bearer value without the key prefix', () => {
    const context = buildRpcContext(
      requestWith('Bearer something-else'),
      access,
      new MemoryTaskStore(),
      repositories,
      { apiKeys: verifier },
    );

    expect(context.presentedApiKey).toBeUndefined();
  });

  it('carries no session unless the transport passes one', () => {
    const context = buildRpcContext(requestWith(), access, new MemoryTaskStore(), repositories, {
      apiKeys: verifier,
    });

    expect(context.auth).toBeUndefined();
  });
});

describe('apiKeyVerifier', () => {
  it('is absent for an instance that serves no API keys', () => {
    expect(apiKeyVerifier({ api: {} })).toBeUndefined();
  });

  it('passes a well-formed answer through', async () => {
    const answer = {
      valid: true,
      key: { id: 'key_1', referenceId: 'org_1', permissions: { task: ['create'] } },
    };
    const verify = apiKeyVerifier({ api: { verifyApiKey: () => Promise.resolve(answer) } });

    await expect(verify?.verifyApiKey({ body: { key: 'cz_x' } })).resolves.toEqual(answer);
  });

  it('refuses an answer it cannot read', async () => {
    const verify = apiKeyVerifier({
      api: { verifyApiKey: () => Promise.resolve({ valid: true, key: { id: 'key_1' } }) },
    });

    await expect(verify?.verifyApiKey({ body: { key: 'cz_x' } })).resolves.toEqual({
      valid: false,
      key: null,
    });
  });
});
