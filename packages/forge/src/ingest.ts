import { redactSecrets, secretValuesFromEnvironment, type FeedbackItem } from '@code-zero/shared';
import type { ForgeEvent, ForgeProvider } from 'forges';

import { classifyEvent } from './classify.js';
import {
  isForgeKind,
  type ChangeRequestRef,
  type ForgeKind,
  type IssueEvent,
  type ReviewEvent,
} from './contracts.js';
import { providerSecrets, type ForgeRegistry } from './registry.js';
import { changeRequestFrom, issueFrom, ThreadReader } from './resolve.js';
import type { AuthorFilter } from './untrusted.js';

/** One inbound webhook request. The body is the raw bytes; signatures verify it verbatim. */
export interface WebhookDelivery {
  headers: Headers | Readonly<Record<string, string | undefined>>;
  body: string | Uint8Array;
}

export interface IngestOptions extends AuthorFilter {
  /** The instance host the delivery is for, when a deployment connects several of one forge. */
  instance?: string;
  /**
   * Issue tasks, when repository policy enables them. Without this every issue event is ignored,
   * so issue text cannot start a run unless policy opted in.
   */
  issues?: { requireLabel: string };
}

/** An event the delivery carried that asks Code Zero for nothing, and why. */
export interface IgnoredEvent {
  id: string;
  /** The forge's own event name. */
  event: string;
  reason: string;
}

export type IngestOutcome =
  | {
      status: 'rejected';
      reason: 'unknown-forge' | 'webhooks-unsupported' | 'invalid-signature' | 'malformed-delivery';
      /** Safe to log: built from forge names and redacted library messages only. */
      detail: string;
    }
  | {
      status: 'ingested';
      reviews: ReviewEvent[];
      issues: IssueEvent[];
      ignored: IgnoredEvent[];
    };

/**
 * Verify one delivery and translate it into Code Zero's review and issue events.
 *
 * A forged, unsigned, or unparseable delivery is a typed rejection rather than a thrown error, so
 * a webhook route maps it to a status code without a catch-all. Nothing here chooses a run mode:
 * the events carry what happened, and policy decides what a run may do. A failure reading the
 * forge's record of a thread is thrown, so the route answers with an error and the forge retries
 * the delivery instead of Code Zero dropping it.
 */
export async function ingestDelivery(
  registry: ForgeRegistry,
  kind: string,
  delivery: WebhookDelivery,
  options: IngestOptions = {},
): Promise<IngestOutcome> {
  const provider = isForgeKind(kind) ? registry.get(kind, options.instance) : undefined;
  if (!isForgeKind(kind) || !provider)
    return { status: 'rejected', reason: 'unknown-forge', detail: 'no connection for this forge' };
  if (!provider.can('webhooks.ingest'))
    return {
      status: 'rejected',
      reason: 'webhooks-unsupported',
      detail: `the ${kind} connection cannot receive webhooks`,
    };

  const input = { headers: headerRecord(delivery.headers), body: delivery.body };
  if (!(await provider.webhooks.verify(input)))
    return { status: 'rejected', reason: 'invalid-signature', detail: 'the signature is invalid' };

  let events: ForgeEvent[];
  try {
    events = await provider.webhooks.ingest(input);
  } catch (error) {
    return { status: 'rejected', reason: 'malformed-delivery', detail: describe(provider, error) };
  }
  return translate(kind, provider, events, options);
}

async function translate(
  kind: ForgeKind,
  provider: ForgeProvider,
  events: readonly ForgeEvent[],
  options: IngestOptions,
): Promise<IngestOutcome> {
  const reader = new ThreadReader(kind, provider);
  const proactive = new Map<string, ChangeRequestRef>();
  const feedback = new Map<string, { changeRequest: ChangeRequestRef; items: FeedbackItem[] }>();
  const issues = new Map<string, IssueEvent>();
  const ignored: IgnoredEvent[] = [];
  const skip = (event: ForgeEvent, reason: string) =>
    ignored.push({ id: event.id, event: event.kindRaw ?? event.kind, reason });

  for (const event of events) {
    const classified = classifyEvent(event, options);
    if (classified.type === 'ignore') {
      skip(event, classified.reason);
      continue;
    }
    if (classified.type === 'issue') {
      if (!options.issues) skip(event, 'issue tasks are not enabled');
      else if (!provider.can('threads.get', 'issue')) skip(event, `${kind} has no issues to read`);
      else {
        const thread = await reader.read(classified.thread);
        const issue = issueFrom(kind, thread, options.issues.requireLabel, options);
        if (issue.ok) issues.set(String(issue.value.issue.number), issue.value);
        else skip(event, issue.reason);
      }
      continue;
    }

    const thread = await reader.read(classified.thread);
    const resolved = changeRequestFrom(kind, thread);
    if (!resolved.ok) {
      skip(event, resolved.reason);
      continue;
    }
    const key = String(resolved.value.number);
    if (classified.type === 'proactive') {
      // A draft is its author saying the change is not ready to be read.
      if (thread.isDraft) skip(event, 'the change request is a draft');
      else proactive.set(key, resolved.value);
      continue;
    }
    const entry = feedback.get(key) ?? { changeRequest: resolved.value, items: [] };
    entry.items.push(classified.item);
    feedback.set(key, entry);
  }

  const reviews: ReviewEvent[] = [
    ...Array.from(proactive.values(), (changeRequest) => ({
      forge: kind,
      trigger: 'proactive' as const,
      changeRequest,
      items: [],
      requestedChanges: false,
    })),
    ...Array.from(feedback.values(), ({ changeRequest, items }) => ({
      forge: kind,
      trigger: 'feedback' as const,
      changeRequest,
      items,
      requestedChanges: items.some((item) => item.requestedChanges),
    })),
  ];
  return { status: 'ingested', reviews, issues: [...issues.values()], ignored };
}

function headerRecord(headers: WebhookDelivery['headers']): Headers | Record<string, string> {
  if (headers instanceof Headers) return headers;
  const record: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers))
    if (value !== undefined) record[name] = value;
  return record;
}

function describe(provider: ForgeProvider, error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : 'unreadable';
  return redactSecrets(message, [
    ...providerSecrets(provider),
    ...secretValuesFromEnvironment(),
  ]).slice(0, 500);
}
