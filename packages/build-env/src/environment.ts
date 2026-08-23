import { hasProtocol, withHttps } from 'ufo';

import type { EnvironmentRecord, EnvType } from './types.js';

/**
 * What one hosting provider can tell a bundle about the deploy it belongs to.
 *
 * Everything is nullable: a provider that exposes a branch but no pull-request number reports the
 * branch and leaves the rest for git, or for the run-time pass, to fill in.
 */
export interface DeploymentMetadata {
  /** Which reader produced these values, so the resolution can be explained in a log or a test. */
  readonly provider: string;
  readonly branch: string | null;
  readonly commit: string | null;
  readonly prNumber: string | null;
  /** URL of this specific deploy, whichever kind of deploy it is. */
  readonly deployUrl: string | null;
  /** URL of the production domain, when the provider names it separately from the deploy URL. */
  readonly productionUrl: string | null;
  /** `null` when the provider exposes no notion of production versus preview. */
  readonly context: 'production' | 'preview' | null;
}

/**
 * Matches the ref a workflow triggered by `pull_request` runs on, capturing the number.
 *
 * @see https://docs.github.com/actions/reference/variables-reference
 */
const pullRequestRefPattern = /^refs\/pull\/(\d+)\//;

/** The branch a deploy has to be on to count as `canary` rather than `preview`, absent an override. */
const defaultBranchName = 'main';

/** Reads a variable, treating one that is set but blank as absent. */
function read(environment: EnvironmentRecord, name: string): string | null {
  return environment[name]?.trim() || null;
}

/** Reads the first of `names` that is set, so a provider can be given more than one spelling. */
function readFirst(environment: EnvironmentRecord, ...names: readonly string[]): string | null {
  for (const name of names) {
    const value = read(environment, name);
    if (value) return value;
  }
  return null;
}

/**
 * Turns a bare host name into a URL.
 *
 * Vercel's `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL` omit the scheme, unlike Netlify's
 * `URL`, so every reader normalises through here rather than each one remembering which is which.
 *
 * An existing scheme is kept exactly as given — including a deliberate `http://` on
 * `AGENT_ZERO_BUILD_URL` for an internal, TLS-less self-hosted deploy — and only a value with none
 * gets `https://` added, via `ufo`'s `withHttps` rather than a scheme regex of our own (it is
 * already in the tree: Nuxt, h3, and vue-router all depend on it).
 */
function toUrl(value: string | null): string | null {
  if (!value) return null;
  return hasProtocol(value) ? value : withHttps(value);
}

/** What a provider needs from the caller to classify its own deploy. */
interface ProviderOptions {
  /** The branch this project treats as production; `main` unless the caller says otherwise. */
  readonly defaultBranch: string;
}

interface DeploymentProvider {
  readonly name: string;
  /** Whether this provider is the one that built or is running the bundle. */
  detects(environment: EnvironmentRecord): boolean;
  read(
    environment: EnvironmentRecord,
    options: ProviderOptions,
  ): Omit<DeploymentMetadata, 'provider'>;
}

/**
 * The providers this project resolves build metadata from, in precedence order.
 *
 * `self-hosted` comes first on purpose. It is the escape hatch — a deployment that sets
 * `AGENT_ZERO_BUILD_*` has said what it is, and nothing auto-detected should be able to contradict
 * it. Everything after it is auto-detection, most specific first: a Vercel build also has
 * `GITHUB_*` variables when it was triggered from a GitHub Actions run, and only the Vercel ones
 * describe the deploy.
 */
const deploymentProviders: readonly DeploymentProvider[] = [
  {
    // The self-hosted contract, and the only vocabulary a deployment that is not on any of the
    // providers below can use. Documented in each app's `.env.example`.
    name: 'self-hosted',
    detects: (environment) =>
      Boolean(
        readFirst(
          environment,
          'AGENT_ZERO_BUILD_COMMIT',
          'AGENT_ZERO_BUILD_BRANCH',
          'AGENT_ZERO_BUILD_URL',
          'AGENT_ZERO_BUILD_PR_NUMBER',
          'AGENT_ZERO_BUILD_PRODUCTION_URL',
        ),
      ),
    read: (environment) => ({
      branch: read(environment, 'AGENT_ZERO_BUILD_BRANCH'),
      commit: read(environment, 'AGENT_ZERO_BUILD_COMMIT'),
      prNumber: read(environment, 'AGENT_ZERO_BUILD_PR_NUMBER'),
      deployUrl: toUrl(read(environment, 'AGENT_ZERO_BUILD_URL')),
      productionUrl: toUrl(read(environment, 'AGENT_ZERO_BUILD_PRODUCTION_URL')),
      context: null,
    }),
  },
  {
    // @see https://vercel.com/docs/environment-variables/system-environment-variables
    name: 'vercel',
    detects: (environment) => Boolean(readFirst(environment, 'VERCEL', 'VERCEL_ENV')),
    read: (environment) => ({
      branch: read(environment, 'VERCEL_GIT_COMMIT_REF'),
      commit: read(environment, 'VERCEL_GIT_COMMIT_SHA'),
      prNumber: read(environment, 'VERCEL_GIT_PULL_REQUEST_ID'),
      // `NUXT_ENV_VERCEL_URL` is the same value re-exposed under the prefix Vercel's framework
      // integration adds; either can be the one that survives into the build.
      deployUrl: toUrl(readFirst(environment, 'VERCEL_URL', 'NUXT_ENV_VERCEL_URL')),
      productionUrl: toUrl(
        readFirst(
          environment,
          'VERCEL_PROJECT_PRODUCTION_URL',
          'NUXT_ENV_VERCEL_PROJECT_PRODUCTION_URL',
        ),
      ),
      context: read(environment, 'VERCEL_ENV') === 'production' ? 'production' : 'preview',
    }),
  },
  {
    // @see https://docs.netlify.com/build/configure-builds/environment-variables/#git-metadata
    name: 'netlify',
    detects: (environment) => Boolean(readFirst(environment, 'NETLIFY', 'CONTEXT')),
    read: (environment) => ({
      branch: readFirst(environment, 'BRANCH', 'HEAD'),
      commit: read(environment, 'COMMIT_REF'),
      prNumber: read(environment, 'REVIEW_ID'),
      deployUrl: toUrl(readFirst(environment, 'DEPLOY_PRIME_URL', 'DEPLOY_URL', 'URL')),
      productionUrl: toUrl(read(environment, 'URL')),
      context: read(environment, 'CONTEXT') === 'production' ? 'production' : 'preview',
    }),
  },
  {
    // @see https://developers.cloudflare.com/pages/configuration/build-configuration/
    name: 'cloudflare-pages',
    detects: (environment) => Boolean(read(environment, 'CF_PAGES')),
    read: (environment, options) => ({
      branch: read(environment, 'CF_PAGES_BRANCH'),
      commit: read(environment, 'CF_PAGES_COMMIT_SHA'),
      // Cloudflare Pages exposes no pull-request number; a PR deploy is recognised by its branch
      // not being the production one, which the context below already covers.
      prNumber: null,
      deployUrl: toUrl(read(environment, 'CF_PAGES_URL')),
      productionUrl: null,
      // The caller's configured production branch, not the module default: a project whose
      // production branch is not `main` must still be classified `production` here, or every
      // deploy of it — including the real production one — reads as a preview.
      context:
        read(environment, 'CF_PAGES_BRANCH') === options.defaultBranch ? 'production' : 'preview',
    }),
  },
  {
    // The last auto-detected source, and the only one that is a CI runner rather than a host: it
    // describes the commit a container image was built from when nothing else does.
    // @see https://docs.github.com/actions/reference/variables-reference
    name: 'github-actions',
    detects: (environment) => read(environment, 'GITHUB_ACTIONS') === 'true',
    read: (environment) => ({
      // `GITHUB_REF_NAME` is `<pr-number>/merge` on a `pull_request` event, not a branch name;
      // `GITHUB_HEAD_REF` names the actual source branch and is only set for that event, so it is
      // preferred when present and the ref-name form is used for every other trigger.
      branch: readFirst(environment, 'GITHUB_HEAD_REF', 'GITHUB_REF_NAME'),
      commit: read(environment, 'GITHUB_SHA'),
      // `refs/pull/<number>/merge` is the only place a workflow triggered by `pull_request` carries
      // the number without reading the event payload off disk.
      prNumber: pullRequestRefPattern.exec(read(environment, 'GITHUB_REF') ?? '')?.[1] ?? null,
      deployUrl: null,
      productionUrl: null,
      context: null,
    }),
  },
];

/** The metadata a provider that recognises nothing reports. */
const noMetadata: DeploymentMetadata = {
  provider: 'none',
  branch: null,
  commit: null,
  prNumber: null,
  deployUrl: null,
  productionUrl: null,
  context: null,
};

/**
 * Resolves what the environment says about the deploy, from the first provider that recognises it.
 *
 * Only the first match is read. Merging providers would let a stale variable from one host survive
 * into a deploy on another — the exact failure a deployment moved between hosts would hit — so a
 * provider either describes the deploy or has nothing to say about it.
 */
export function deploymentMetadataFromEnvironment(
  environment: EnvironmentRecord,
  defaultBranch: string = defaultBranchName,
): DeploymentMetadata {
  const provider = deploymentProviders.find((candidate) => candidate.detects(environment));
  if (!provider) return noMetadata;
  return { provider: provider.name, ...provider.read(environment, { defaultBranch }) };
}

/**
 * Classifies the deploy the metadata describes.
 *
 * `dev` wins over everything: a developer running `nuxt dev` with a `.env` copied off a deploy is
 * still on their own machine. Past that, a pull-request deploy is always a preview whatever branch
 * it is on, the default branch outside a pull request is the canary, and only a provider that says
 * `production` earns `release`.
 */
export function envTypeFromMetadata(
  metadata: DeploymentMetadata,
  options: { readonly isDevelopment: boolean; readonly defaultBranch?: string },
): EnvType {
  if (options.isDevelopment) return 'dev';
  if (metadata.prNumber !== null) return 'preview';

  // No provider recognised the deploy, so there is no preview channel to be on: a self-hosted
  // bundle is whatever it was built to be, and `AGENT_ZERO_BUILD_ENV` is how it says otherwise.
  if (metadata.context === null) return 'release';
  if (metadata.context === 'production') return 'release';

  return metadata.branch === (options.defaultBranch ?? defaultBranchName) ? 'canary' : 'preview';
}

/**
 * An explicit override of the classification, honoured at build time and again at run time.
 *
 * The one field a deployment can always state outright: a self-hosted staging environment is a
 * `preview` in every way that matters to the people looking at it, and no amount of provider
 * detection can work that out from a plain `node .output/server/index.mjs`.
 */
export function envTypeOverrideFromEnvironment(environment: EnvironmentRecord): EnvType | null {
  const value = read(environment, 'AGENT_ZERO_BUILD_ENV');
  if (!value) return null;
  return value === 'dev' || value === 'preview' || value === 'canary' || value === 'release'
    ? value
    : null;
}

/** The deploy's own URL, reported only when this deploy is not the production one. */
export function previewUrlFromMetadata(metadata: DeploymentMetadata, env: EnvType): string | null {
  return env === 'release' ? null : metadata.deployUrl;
}

/** The production domain, reported only when this deploy serves it. */
export function productionUrlFromMetadata(
  metadata: DeploymentMetadata,
  env: EnvType,
): string | null {
  if (env !== 'release') return null;
  return metadata.productionUrl ?? metadata.deployUrl;
}
