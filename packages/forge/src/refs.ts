import type { IssueRef } from '@code-zero/shared';
import type { RepoRef, ThreadRef } from 'forges';

import type { ChangeRequestRef, ForgeRepository } from './contracts.js';

/** The repository ref `forges` addresses, from Code Zero's forge-neutral one. */
export function repoRef(target: ForgeRepository): RepoRef {
  return { forge: target.forge, instance: target.instance, owner: target.owner, name: target.repo };
}

export function changeRequestThread(target: ChangeRequestRef): ThreadRef {
  return {
    forge: target.forge,
    instance: target.instance,
    repo: repoRef(target),
    kind: 'pull_request',
    number: String(target.number),
  };
}

/** An issue in a repository, or an Azure DevOps work item, whose `repo` is the empty project ref. */
export interface IssueTarget extends Omit<ForgeRepository, 'owner' | 'repo'> {
  issue: IssueRef;
}

export function issueThread(target: IssueTarget): ThreadRef {
  const { owner, repo, number } = target.issue;
  return {
    forge: target.forge,
    instance: target.instance,
    repo: {
      forge: target.forge,
      instance: target.instance,
      owner,
      name: repo,
      ...(repo.length === 0 ? { kind: 'namespace' as const } : {}),
    },
    kind: 'issue',
    number: String(number),
  };
}
