import type { OpenAPIDocument } from '@orpc/openapi';

/**
 * `POST /webhooks/github`, documented as an OpenAPI 3.1 webhook rather than a path.
 *
 * The route is a plain Nitro handler (`routes/webhooks/github.post.ts`), not an oRPC procedure:
 * GitHub signs the exact bytes of the request body, and `OpenAPIHandler` parses the body to build
 * a procedure's input before a handler sees it, which would leave `ingestWebhook` verifying a
 * re-serialisation instead of the delivered payload. The `webhooks` field exists precisely for
 * requests the API provider receives rather than serves — see
 * {@link https://github.com/OAI/OpenAPI-Specification/blob/main/versions/3.1.0.md#oasWebhooks | OpenAPI 3.1 § 4.8.1} —
 * so `/api/v1/docs` documents this delivery without routing it through the OpenAPI transport.
 */
// `satisfies` (rather than a type annotation) checks this against the document's declared shape
// without widening it to `PathItemObject | ReferenceObject`: the binding keeps its literal type,
// so `githubWebhookPathItem.post` and its fields stay concretely typed for the unit suite below.
export const githubWebhookPathItem = {
  post: {
    summary: 'GitHub webhook delivery',
    description:
      'Registered as the repository or organization webhook target. Verifies the `X-Hub-Signature-256` HMAC ' +
      'against the configured secret before parsing the payload, then delegates to the same policy and ' +
      'runner boundary as the authenticated control plane.',
    parameters: [
      {
        name: 'X-GitHub-Event',
        in: 'header',
        required: true,
        schema: { type: 'string' },
        description: 'The event type GitHub is delivering, e.g. `issues` or `issue_comment`.',
      },
      {
        name: 'X-Hub-Signature-256',
        in: 'header',
        required: true,
        schema: { type: 'string' },
        description:
          'HMAC SHA-256 of the raw body, prefixed `sha256=`, keyed by the configured webhook secret.',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            description: "GitHub's event payload for the delivered event type.",
          },
        },
      },
    },
    responses: {
      '200': {
        description:
          'The delivery was accepted and a task was created, or ignored as not actionable.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['accepted', 'ignored'] },
                taskId: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['status'],
            },
          },
        },
      },
      '400': {
        description:
          'The signature did not match, the event names no actionable delivery, or the body is not valid JSON.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { status: { type: 'string', enum: ['rejected'] } },
              required: ['status'],
            },
          },
        },
      },
      '503': {
        description:
          'This deployment has no webhook secret or checkout path configured, so it accepts no deliveries.',
      },
    },
  },
} satisfies NonNullable<OpenAPIDocument['webhooks']>[string];
