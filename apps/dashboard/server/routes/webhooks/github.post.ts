import { githubTokenFromEnvironment, ingestWebhook } from '@code-zero/api';

/**
 * The production GitHub webhook entry point at `POST /webhooks/github`.
 *
 * This route only adapts transport: it maps headers and body onto the provider-neutral webhook
 * contract and injects the deployment's durable stores. Signature verification, provider
 * routing, policy checks, delivery claims, and everything that can execute repository work stay
 * behind `ingestWebhook`, and the durable `deliveryClaimStore` is what lets a redelivered issue
 * event observe the recorded outcome across restarts and other instances instead of starting a
 * duplicate run. Without a configured secret or checkout the route fails closed and ingests
 * nothing.
 */
export default defineEventHandler(async (event) => {
  const secret = githubWebhookSecretFromEnvironment(process.env);
  if (!secret) throw errors.misconfigured('GITHUB_WEBHOOK_SECRET');
  const checkoutPath = checkoutPathFromEnvironment(process.env);
  if (!checkoutPath) throw errors.misconfigured('CODE_ZERO_CHECKOUT_PATH');

  const request = toWebRequest(event);
  let outcome;
  try {
    outcome = await ingestWebhook(
      {
        body: await request.text(),
        headers: Object.fromEntries(request.headers.entries()),
      },
      {
        providers: [{ kind: 'github', secret }],
        checkoutPath,
        store: taskStore,
        deliveryClaims: deliveryClaimStore,
        github: { token: githubTokenFromEnvironment() },
      },
    );
  } catch (error) {
    throw errors.internal(error);
  }

  // The response never carries the run's evidence or result; GitHub's delivery log only needs
  // the disposition, and everything else is reachable through the authenticated control plane.
  // A rejected delivery is a client-side signature failure, not a server fault, so it answers
  // 400 with its own body rather than an error envelope.
  if (outcome.status === 'rejected') {
    setResponseStatus(event, 400);
    return { status: 'rejected' };
  }
  if (outcome.status === 'ignored') return { status: 'ignored', reason: outcome.reason };
  return { status: 'accepted', taskId: outcome.result.id };
});
