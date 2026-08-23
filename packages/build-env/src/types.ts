/**
 * Which deployment of the project a running bundle is: the four names every surface that shows
 * build metadata switches on.
 *
 * `canary` is the default branch deployed outside a pull request but not yet promoted to the
 * production domain; `preview` is any other non-production deploy (a pull request, a branch
 * deploy); `release` is production; `dev` is a developer's own machine.
 */
export type EnvType = 'dev' | 'preview' | 'canary' | 'release';

/**
 * The build metadata a deployment publishes about itself.
 *
 * Every field that can fail to resolve is `null` rather than a sentinel string — one
 * representation for "not known yet", checked the same way (`??`) everywhere it is completed or
 * displayed, instead of a string family for revision fields and `null` for everything else.
 */
export interface BuildInfo {
  /** The deployed package's own version, read from its `package.json` at build time. */
  version: string;
  /** Full commit SHA, or `null` when neither the host nor git could name one. */
  commit: string | null;
  /** Git branch, or `null`. */
  branch: string | null;
  /** Which deployment this is. */
  env: EnvType;
  /** Build timestamp in milliseconds since the epoch. */
  time: number;
  /** Pull request number when this is a pull-request deploy, `null` otherwise. */
  prNumber: string | null;
  /** URL of this specific deploy, only when it is not the production one. */
  previewUrl: string | null;
  /** URL of the production domain, only when this deploy serves it. */
  productionUrl: string | null;
}

/** A read-only view of an environment, so resolvers never reach for `process.env` themselves. */
export type EnvironmentRecord = Readonly<Record<string, string | undefined>>;
