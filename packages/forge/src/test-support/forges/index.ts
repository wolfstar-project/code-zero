import type { ForgeFixture } from '../forge-fixture.js';
import { azureDevOpsFixture } from './azure-devops.js';
import { bitbucketFixture } from './bitbucket.js';
import { forgejoFixture, giteaFixture } from './gitea.js';
import { githubFixture } from './github.js';
import { gitlabFixture } from './gitlab.js';

/** One fixture per forge Code Zero connects to in v1. */
export const forgeFixtures: readonly ForgeFixture[] = [
  githubFixture,
  gitlabFixture,
  giteaFixture,
  forgejoFixture,
  bitbucketFixture,
  azureDevOpsFixture,
];
