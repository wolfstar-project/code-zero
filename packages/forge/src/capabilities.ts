import type { ForgeProvider, Support } from 'forges';

import { commitFilesSupport } from './commit-files.js';
import type { CapabilityLevel, ForgeCapabilities, ForgeKind } from './contracts.js';

function level(support: Support): CapabilityLevel {
  if (support === true) return 'native';
  if (support === false) return 'unsupported';
  return support;
}

/** What one connection can do for Code Zero, read from its provider without a request. */
export function forgeCapabilities(kind: ForgeKind, provider: ForgeProvider): ForgeCapabilities {
  return {
    forge: kind,
    webhooks: level(provider.support('webhooks.ingest')),
    changeRequestReads: level(provider.support('threads.get', 'pull_request')),
    issueReads: level(provider.support('threads.get', 'issue')),
    discovery: level(provider.support('threads.listPage', 'pull_request')),
    statusReporting: level(provider.support('checks.report')),
    changeRequestComments: level(provider.support('threads.comment', 'pull_request')),
    issueComments: level(provider.support('threads.comment', 'issue')),
    stableComments: level(provider.support('threads.upsertComment', 'pull_request')),
    commitFiles: level(commitFilesSupport(provider)),
    pullRequestCreation: level(provider.support('threads.create', 'pull_request')),
  };
}
