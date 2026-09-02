import { rpcRouter } from '@code-zero/api';
import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod';
import { describe, expect, it } from 'vitest';

import { githubWebhookPathItem } from '../../server/utils/openapi.js';

describe('githubWebhookPathItem', () => {
  it('documents the delivery headers, success and failure bodies', () => {
    const post = githubWebhookPathItem.post;
    expect(post?.parameters?.map((parameter) => parameter.name)).toEqual([
      'X-GitHub-Event',
      'X-Hub-Signature-256',
    ]);
    expect(Object.keys(post?.responses ?? {})).toEqual(['200', '400', '503']);
  });

  it('merges into the generated spec as a webhook rather than a path the transport serves', async () => {
    const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });
    const spec = await generator.generate(rpcRouter, {
      base: {
        info: { title: 'Code Zero control plane', version: '0.3.0' },
        webhooks: { github: githubWebhookPathItem },
      },
    });

    // `generate()` deep-clones `base` into the document, so the merged entry is a copy.
    expect(spec.webhooks?.github).toEqual(githubWebhookPathItem);
    // The webhook route is a plain Nitro handler, never routed through `OpenAPIHandler` — it must
    // not also appear as a path this transport would try to match and serve.
    expect(Object.keys(spec.paths ?? {})).not.toContain('/webhooks/github');
  });
});
