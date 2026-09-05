<div align="center">

<img src="https://cdn.wolfstar.rocks/wolfstar-assets/wolfstar.png" alt="WolfStar Logo" width="100px" />

# Code Zero

**An open-source autonomous engineer that finds, fixes, and verifies problems in pull requests**

[![GitHub License](https://img.shields.io/github/license/wolfstar-project/code-zero?style=flat-square)](https://github.com/wolfstar-project/code-zero/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/wolfstar-project/code-zero/ci.yaml?branch=main&style=flat-square&label=ci)](https://github.com/wolfstar-project/code-zero/actions/workflows/ci.yaml)
[![Node.js](https://img.shields.io/node/v/typescript?style=flat-square&label=node&color=5FA04E)](https://nodejs.org)
[![Package manager: aube](https://img.shields.io/badge/package%20manager-aube-a1b858?style=flat-square)](https://aube.jdx.dev)

</div>

---

## Documentation

The full documentation — getting started, architecture, configuration, API, authentication, and deployment — lives in [`apps/docs`](./apps/docs), a [Docus](https://docus.dev) site. Run it locally with `aube run dev --filter=@code-zero/docs`. The canonical architecture and provider references stay in [`docs/`](./docs) and are included by the site, so both always read the same source.

---

## Overview

Code Zero runs one trustworthy loop: ingest review feedback, inspect a pull-request diff proactively, or take on a scoped GitHub issue, validate the finding, apply a narrowly scoped policy-approved fix, run the repository's real checks, inspect the resulting diff, and produce evidence.

Feedback is never treated as truth merely because it came from a human or an AI reviewer.

- **Evidence over assertion** &ndash; every fix carries the commands that verified it.
- **Proactive, not speculative** &ndash; diff review reports the highest-priority finding only when checkout evidence supports it.
- **Confidence and impact gates** &ndash; automatic fixes require confidence, an allowed change-risk class, repository permission, and verification.
- **Issues become reviewable pull requests** &ndash; a labeled, repository-scoped issue can be investigated, implemented on an isolated branch, verified, and published as a pull request that carries its acceptance criteria and evidence; never as a direct commit.
- **`observe` by default** &ndash; the safe mode inspects and reports, and never writes to a target repository.
- **One execution boundary** &ndash; `packages/runner` is the only code allowed to run commands or mutate a checkout.
- **Adapters at the edges** &ndash; the runtime stays independent of HTTP, source-control platforms, terminal UI, and model providers.

---

## Architecture

```text
Source-control adapters (GitHub, GitLab, Bitbucket, Gitea) / CLI
        │
        ▼
   Agent state machine
 discover → understand → validate → plan → execute → verify → review
                                      │                    │
                                      └──── repair ◀───────┘
        │
        ▼
 Runner boundary ─── repository commands and file operations

Nuxt dashboard ─── UI, oRPC + OpenAPI routes, and Better Auth, one app ─── database ─── Postgres
```

| Package                                                | Responsibility                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [`packages/agent`](./packages/agent)                   | Orchestration and state transitions                                                        |
| [`packages/runner`](./packages/runner)                 | The only boundary that executes commands or mutates a checkout                             |
| [`packages/models`](./packages/models)                 | Model-provider abstractions                                                                |
| [`packages/source-control`](./packages/source-control) | Provider-neutral source-control contracts and adapters (GitHub, GitLab, Bitbucket, Gitea)  |
| [`packages/config`](./packages/config)                 | Configuration parsing and policy                                                           |
| [`packages/shared`](./packages/shared)                 | Stable cross-package contracts                                                             |
| [`packages/cli`](./packages/cli)                       | Argument parsing and terminal presentation                                                 |
| [`packages/database`](./packages/database)             | Schema, Drizzle client, and checked-in migrations; the only package that talks to Postgres |
| [`packages/auth`](./packages/auth)                     | Authentication policy and the Better Auth options factory                                  |
| [`packages/api`](./packages/api)                       | oRPC router and control-plane operations                                                   |
| [`apps/dashboard`](./apps/dashboard)                   | The single deployable app: UI, `/rpc/**` + `/api/v1/**`, and `/api/auth/**`                |
| [`apps/marketing`](./apps/marketing)                   | Nuxt public marketing site; frontend only, no persistence                                  |

Adapters depend on the runtime; the runtime never depends on adapters. See [docs/architecture.md](./docs/architecture.md) for the full dependency rules.

### Local ports

Each app's `aube --filter <name> run dev` binds a fixed port, so they can all run side by side:

| App                                        | Port   | `aube --filter` name      |
| ------------------------------------------ | ------ | ------------------------- |
| [`apps/dashboard`](./apps/dashboard)       | `3000` | `@code-zero/dashboard`    |
| [`apps/marketing`](./apps/marketing)       | `3001` | `@code-zero/marketing`    |
| [`apps/docs`](./apps/docs)                 | `3002` | `@code-zero/docs`         |
| [`apps/mail-preview`](./apps/mail-preview) | `3005` | `@code-zero/mail-preview` |

---

## Quick start

Requirements: Node.js 24.2+ and [aube](https://aube.jdx.dev), the package manager pinned in `package.json`. Both are pinned in `mise.toml`, so [mise](https://mise.jdx.dev) can install them together. Generated Node.js bundles target Node.js 24.2+.

```bash
mise install            # or: npm install -g --ignore-scripts=false @endevco/aube
aube ci
cp .env.example .env
cp apps/dashboard/.env.example apps/dashboard/.env
aube test
aube run zero doctor
aube run zero review --feedback "Possible null dereference in src/user.ts"
aube run zero review --proactive
aube run dev
```

The root `.env` configures the CLI. Each app loads its own file: the dashboard uses
`apps/dashboard/.env`, while the docs app optionally uses `apps/docs/.env` for `NUXT_APP_BASE_URL`.

To see the dashboard before configuring anything, start it on its own instead:

```bash
mise install
aube ci
aube run dev:solo        # http://localhost:3000, then sign up at /signup
```

`dev:solo` is `nuxt dev` reading [`apps/dashboard/.env.solo`](./apps/dashboard/.env.solo) in place of
`.env`: Better Auth runs on an in-memory store, so there is no Postgres to install and no migration
to apply, and the account you create lives until you stop the process. Nothing else about the app
changes — it is the same UI, the same router, and the same authentication endpoints a deployment
serves. Tasks still need a checkout to target, so add one to
`CODE_ZERO_CONTROL_PLANE_REPOSITORIES` in that file; `observe` runs no model, so a task can be
created and inspected without a provider credential. Use `aube run dev` and `apps/dashboard/.env`
for anything that has to persist.

`aube run <script>` and `aube test` check install freshness first, so a separate install step is rarely needed. aube reads and writes the existing `pnpm-lock.yaml` and `pnpm-workspace.yaml` in place — the lockfile stays in pnpm's v9 format for anyone who still runs pnpm.

---

## CLI

```text
zero init                   create .code-zero.yml
zero --version              print the injected CLI version
zero doctor [--json]        inspect the local environment
zero login [--url X]        sign this machine in through the device flow
zero logout [--url X]       forget a stored session
zero review (--feedback X | --proactive)  inspect without editing
zero fix (--feedback X | --proactive)     validate, edit, and verify (policy permitting)
zero run (--feedback X | --proactive)     run using the configured mode
```

The CLI parses arguments with [`@bomb.sh/args`](https://github.com/bomb-sh/args) and renders with [`@clack/prompts`](https://github.com/bombshell-dev/clack). Use `--proactive` to inspect the working-tree diff without reviewer feedback. When neither trigger is provided in a terminal, it asks for the task interactively; use `--feedback` or `--proactive` with `--json` for scripts and CI.

`zero login` runs the [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628) device flow: it prints a short code, you approve it at the deployment's `/device` page in a browser you are already signed into, and the CLI stores the resulting session token in `$XDG_CONFIG_HOME/code-zero/credentials.json` (owner-readable only). The same command serves a cloud-managed deployment and a self-hosted one — pick which with `--url`, or set `CODE_ZERO_URL`; without either it targets `http://localhost:3000`. Tokens are kept per origin, so signing into one deployment never evicts another, and `zero logout` without `--url` forgets all of them. The deployment must have `AUTH_ENABLE_DEVICE_AUTHORIZATION=true`; it is off by default. That flag also registers Better Auth's `bearer` plugin, which is what lets the stored token be presented as `Authorization: Bearer <token>` — without it the flow would mint a session that only a cookie could carry. `zero doctor` lists which deployments have a stored session and whether it has expired, never the token itself.

---

## Dashboard

`aube run dev` starts the single deployable app on `http://localhost:3000` (override with `PORT`). It is the only adapter that composes a runner for hosted work, and the same Nuxt app serves the UI, the control plane, and authentication from one origin:

| Surface        | Purpose                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `/rpc/**`      | Typed oRPC router: `health`, `dashboard.overview`, `tasks.list/get/create`, `approvals.decide`        |
| `/api/v1/**`   | The same router over OpenAPI/REST; interactive docs at `/api/v1/docs`, spec at `/api/v1/openapi.json` |
| `/api/auth/**` | The Better Auth handler (mounted by `@onmax/nuxt-better-auth` from `server/auth.config.ts`)           |

`/rpc/**` and `/api/v1/**` are the same `rpcRouter` from [`packages/api`](./packages/api) served over two wire protocols, so authorization behaves identically either way. Reads are open for the dashboard; mutations (`tasks.create`, `approvals.decide`) fail closed. `CODE_ZERO_CONTROL_PLANE_TOKENS` holds comma-separated `name:token` bearer credentials, and `CODE_ZERO_CONTROL_PLANE_REPOSITORIES` allow-lists the repository paths `tasks.create` may target; without them every mutation is rejected. `CODE_ZERO_CONTROL_PLANE_MODES` holds comma-separated `name:mode|mode` grants for the execution modes each principal may request; without a grant a principal may only request the non-writable `observe` and `suggest` modes, so `fix` and `autonomous` require an explicit operator grant. The approval actor is the authenticated principal's name, never a wire-supplied value. This bearer-token scheme authorizes the control-plane API and is independent of the Better Auth session that protects the dashboard UI.

Typed clients infer their shape from the router rather than redeclaring request and response types:

```ts
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import type { RpcRouter } from '@code-zero/api';

const client: RouterClient<RpcRouter> = createORPCClient(
  new RPCLink({
    url: 'http://localhost:3000/rpc',
    headers: { authorization: `Bearer ${process.env.CONTROL_PLANE_TOKEN}` },
  }),
);

const { tasks } = await client.tasks.list();
await client.approvals.decide({ taskId: tasks[0]!.id, decision: 'approved' });
```

Non-TypeScript or external callers can use plain HTTP against `/api/v1/**` instead — for example `curl http://localhost:3000/api/v1/tasks` — with the same bearer-token rules; the interactive reference at `/api/v1/docs` documents every route from the generated OpenAPI spec.

The transport is Nuxt's own Nitro server: routes live in `apps/dashboard/server/`, and `nuxt build` emits a self-contained `.output/` bundle started with `node .output/server/index.mjs`. Task history persists through a `KeyValueStorage` contract backed by the ViteHub KV Runtime Helper (registered from `apps/dashboard/nuxt.config.ts`): filesystem-backed `fs-lite` by default, with Cloudflare KV, Deno KV, or Upstash dropping in as driver configuration without touching application code. Records are redacted before they are written and never contain review input or checkout paths. `TaskScheduler` bounds work globally and per repository, so a burst queues instead of fanning out unbounded runs.

Authentication is mounted in-process at `/api/auth/**` by `apps/dashboard/server/auth.config.ts`, the one route in the app that resolves `packages/auth`'s environment options — including the connection string, through [`packages/database`](./packages/database) — and therefore the only place in the repository that opens a connection to Postgres. `packages/database` declares the tables with [Drizzle](https://orm.drizzle.team) rather than Better Auth's own migration tool, so the session store's schema lives in this repository as reviewable, checked-in SQL. The dashboard renders with SSR: the session cookie is same-origin, so the server resolves it directly and a signed-out visitor never flashes protected content before redirecting.

Point `DATABASE_URL` at a Postgres database, then apply the schema once before the first run
(`db:generate` only needs to run again after editing `packages/database/src/schema/`):

```bash
aube run db:migrate
```

The app reads auth configuration from the environment. Registration and GitHub OAuth are
off until you turn them on, so a fresh deployment cannot be signed up for by a stranger:

| Variable                                    | Required | Default | Purpose                                                                                                             |
| ------------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `NUXT_BETTER_AUTH_SECRET`                   | yes      | –       | Session signing secret. Required under this name in production; `BETTER_AUTH_SECRET` is a development-only fallback |
| `DATABASE_URL`                              | yes      | –       | Postgres connection string                                                                                          |
| `AUTH_ENABLE_SIGNUP`                        | no       | `false` | Set to `true` to allow self-registration                                                                            |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | no       | –       | Enables the GitHub button when both are set                                                                         |
| `NUXT_PUBLIC_SITE_URL`                      | no       | –       | Base URL override for a custom domain or deterministic OAuth callbacks; auto-detected from the request otherwise    |

`AUTH_DATABASE_URL` is still read when `DATABASE_URL` is unset, so a deployment configured before
the store moved into `packages/database` keeps starting; prefer `DATABASE_URL` for new ones.

Sign-in lives at `/login` and self-registration at `/signup`; the methods each page offers are
derived at build time from the same policy variables `server/auth.config.ts` reads at runtime
(`AUTH_ENABLE_SIGNUP`, `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`), and no runtime override can
change them. The flip side of that build-time capture is a deployment contract: whenever you change
those policy variables, rebuild the app, or the auth pages will keep advertising the old
capabilities (the server still enforces its own policy either way).

The interface ships English and Italian through `@nuxtjs/i18n`, with dictionaries split by scope in
`packages/i18n/locales/<locale>/` and shared with the marketing site; each app loads only the
scopes it renders. `aube run i18n:status` builds a
[Lunaria](https://lunaria.dev) report showing which translations went stale relative to the English
source; it reads git history, so it needs the dictionaries committed.

`aube run test:browser` builds the dashboard, starts the production preview on port 5678, and runs the
Playwright suite against `server/auth.config.ts` running with an in-memory Better Auth adapter and
signup enabled (`AUTH_E2E_MEMORY=true`, set only for that preview server), so the suite creates and
signs in its own throwaway account through the real `/api/auth/**` endpoints instead of a live
database. Use `aube --filter @code-zero/dashboard run test:browser:ui` for Playwright UI mode.

Hosted execution is available through the provider-neutral `RunnerPool`: every lease has a maximum lifetime, quota checks run before provisioning, expired sandboxes are stopped, and the agent receives only the ordinary `Runner` contract. See [the sandbox provider evaluation](./docs/sandbox-providers.md).

Code Zero supports native OpenAI, Anthropic, and Google Generative AI adapters, Vercel AI
Gateway, arbitrary OpenAI-compatible endpoints, and two subscription transports that drive a
locally authenticated vendor CLI. Select the transport in repository policy and provide its
credential through the environment:

| `model.provider`    | Credential kind | Credential environment variable                          | Model example                 |
| ------------------- | --------------- | -------------------------------------------------------- | ----------------------------- |
| `ai-gateway`        | api-key         | `AI_GATEWAY_API_KEY` or Vercel OIDC                      | `anthropic/claude-sonnet-4.5` |
| `anthropic`         | api-key         | `ANTHROPIC_API_KEY`                                      | `claude-sonnet-4-5`           |
| `google`            | api-key         | `GOOGLE_GENERATIVE_AI_API_KEY`                           | `gemini-2.5-pro`              |
| `openai`            | api-key         | `OPENAI_API_KEY`                                         | `gpt-5`                       |
| `openai-compatible` | api-key         | `OPENAI_COMPATIBLE_API_KEY` (or legacy `OPENAI_API_KEY`) | provider-specific             |
| `claude-code`       | subscription    | none; `claude login` on the host                         | `opus`, `sonnet`              |
| `codex-cli`         | subscription    | none; `codex login` on the host                          | `gpt-5.2-codex`               |

`CODE_ZERO_MODEL_BASE_URL` is an optional operator environment variable for custom gateways and
self-hosted endpoints. Endpoint URLs and credentials cannot be named or embedded in
`.code-zero.yml`, so untrusted repository policy cannot redirect a provider secret. The AI Gateway
accepts `provider/model` identifiers and exposes the broader AI SDK provider catalog without adding
provider-specific logic to the Code Zero runtime.

#### Subscription transports

`claude-code` and `codex-cli` spend an existing Claude Pro/Max or ChatGPT Plus/Pro subscription
instead of a metered API key. They drive the vendor CLI installed on the host, so there is no
credential for Code Zero to read, rotate, or redact — the session lives in the CLI's own state.
Both are off unless the matching operator flag is exactly `true`:

```
CODE_ZERO_ENABLE_CLAUDE_CODE_PROVIDER=true   # requires: npm i -g @anthropic-ai/claude-code && claude login
CODE_ZERO_ENABLE_CODEX_CLI_PROVIDER=true     # requires: the Codex CLI on PATH && codex login
```

`CODE_ZERO_CLAUDE_CODE_PATH` and `CODE_ZERO_CODEX_PATH` point at the executable when it is not on
`PATH`. `zero doctor` runs the CLI's `--version` through the runner boundary and reports whether it
is installed; an expired session can only be detected by a real call, and surfaces as
`Run \`claude login\` on this host` rather than a spawn error.

Known limits, all of which follow from the session being local:

- **Single-tenant.** Every run on the host shares one personal account. Rate limits are the
  subscription's, not the request's, and there is no per-user isolation. Do not select these
  transports for a multi-tenant control plane; scope them to one administrative workspace, or keep
  a metered transport for shared work.
- **Host-bound.** The run must execute where `claude login` / `codex login` was completed, and the
  Code Zero process must be allowed to spawn subprocesses.
- **`codex-cli`'s process is not runner-routed.** `claude-code`'s CLI process is spawned through
  `packages/runner`'s `spawnManagedProcess`, the same boundary as every repository check; a
  composition root wires this in (`modelFromEnvironment`'s `ClaudeCodeProcessSpawner` parameter).
  `ai-sdk-provider-codex-cli` exposes no equivalent hook, so Codex's process is always spawned by
  the vendor SDK directly. Its read-only sandbox, disabled approvals, and disabled MCP servers are
  the containment for that one transport instead.
- **Container isolation covers `claude-code`, not `codex-cli`.** When `runner.isolation: container`
  in `.code-zero.yml`, `claude-code`'s CLI process runs in its own container instead of on the host
  (see below) — Codex still can't be routed at all, per the point above.
- **A `RunnerPool` lease refuses `claude-code` rather than running it unisolated.** A hosted
  sandbox provider (`vitehub`/`cloudflare`/`vercel`/`custom`) returns only the ordinary `Runner`
  contract — bounded command execution, never a live process handle — so there is no way to route
  the CLI's duplex spawn through the same boundary the lease already gives repository commands.
  Rather than falling back to a host spawn that would bypass that lease's isolation, lifecycle,
  quota, and audit controls, `packages/api` refuses the transport outright whenever a `runnerPool`
  is configured on the `RunTaskOptions` passed to `runTask`, independent of `runner.isolation`. The
  refusal is reported to `modelFromEnvironment` as a reason, not by turning the enable flag off, so
  a configured `CODE_ZERO_MODEL_FALLBACK_PROVIDER` still gets a turn instead of the run failing
  outright — same as the missing-container-image case below. `codex-cli` has no working code path
  to bypass here in the first place (see above), so this gate is `claude-code`-only.
- **Expiring.** OAuth sessions end; the run fails until an operator logs in again. Set
  `CODE_ZERO_MODEL_FALLBACK_PROVIDER` and `CODE_ZERO_MODEL_FALLBACK_MODEL` to an API-key
  transport to degrade to it automatically when the CLI is missing, its session expired, or its
  usage window is spent and too far from reopening to wait out. The fallback applies to those
  failures only; an invalid model decision never silently switches transports.
- **Rate-limited by plan.** A spent usage window is the one failure that repairs itself, so a run
  waits it out and resumes rather than throwing away the checks and changes it already produced
  (see below).
- **Not metered per call.** Cost accounting reports `0` unless explicit rates are configured, since
  the subscription is billed to the account, not the request.

The CLI is configured as a text generator only: built-in tools are disabled for Claude Code and
Codex runs read-only with approvals off, so neither can read outside the supplied context or edit a
checkout behind the runner boundary. Claude Code additionally sets `disableClaudeAiConnectors`,
because account-level claude.ai connectors are fetched from the server rather than read from disk —
without it, a subscription whose account has connectors enabled hands the model MCP tools that
reach past the runner boundary and pays for their definitions on every call.

##### Isolating the `claude-code` CLI process under container isolation

`runner.isolation: container` is an explicit declaration that command execution must run isolated.
Leaving the subscription CLI unisolated while every repository check runs contained would be
exactly the silent bypass this exists to prevent — so under container isolation, `claude-code`'s
CLI process runs in its own ephemeral container too, and is refused outright rather than falling
back to a host spawn when that container can't be built. The refusal is reported to
`modelFromEnvironment` as a reason rather than by turning the enable flag off, so a configured
`CODE_ZERO_MODEL_FALLBACK_PROVIDER` still gets a turn instead of the run failing outright — the
transport genuinely is configured, this host just can't isolate it:

```
CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE=      # required under container isolation; must have `claude` on PATH
CODE_ZERO_CLAUDE_CODE_CONTAINER_EXECUTABLE= # optional; defaults to "claude" — set if the image installs it elsewhere
CLAUDE_CONFIG_DIR=                           # optional; defaults to ~/.claude
```

Verified end to end against a real container and a real authenticated session — build an image with
`claude` installed and set the variable above, and the full pipeline (spawn, mount, authenticate,
stream a decision) runs isolated. Three things fell out of getting that working, each a genuine
constraint rather than a design choice:

- **No repository checkout mounted, and no `--network` flag.** The CLI is configured as a text
  generator only (`tools: []`, `mcpServers: {}`) and never touches the checkout, so none is
  provided. `permissions.network` is not reused either: that policy contains an _untrusted
  checkout's_ own commands, and has nothing to do with Code Zero's own necessary calls to the
  vendor API — reusing it would simply break every subscription call under `restricted` or `none`.
- **The vendor SDK resolves the CLI to an absolute host path** (its own bundled native binary, or
  `CODE_ZERO_CLAUDE_CODE_PATH`), which does not exist inside the container. The containerized spawn
  always runs the bare executable name from `CODE_ZERO_CLAUDE_CODE_CONTAINER_EXECUTABLE` instead —
  whatever the configured image actually has installed.
- **The CLI's login session spans two host locations that are not nested**: `~/.claude/`
  (credentials, settings) and a sibling file, `~/.claude.json` (project/session record). Docker
  refuses to bind-mount a file to a path inside an already-read-only directory mount, so both are
  mounted as siblings under one synthetic directory instead, with the container's `$HOME` pointed at
  it so the CLI's own default resolution finds both — no `CLAUDE_CONFIG_DIR` override needed unless
  the host already customized it, in which case a single mount plus a matching override is used. The
  container also runs as the host's own UID:GID, not `root`: the mounted credential file typically
  has mode `0600`, `--cap-drop ALL` removes even `root`'s permission-bypass capability inside the
  container, and the CLI verifies file ownership before it trusts a session — reading past that
  check without the right UID is not enough. On a host where the session is Keychain-backed rather
  than file-backed (some macOS configurations), this mount cannot forward it; use `local` isolation
  there instead.

Same hardening baseline as `ContainerRunner`: `--init`, `--cap-drop ALL`, `--security-opt
no-new-privileges`, `--rm`.

##### Waiting out a spent usage window

When the plan's usage window is exhausted, the run does not fail. It waits for the window to reopen
and continues, resuming the interrupted CLI session so the conversation is not rebuilt and paid for
twice. This applies only to the subscription transports; a metered transport has no window to wait
on.

```
CODE_ZERO_SUBSCRIPTION_LIMIT_WAIT_MS=3600000   # default; 0 disables waiting entirely
```

The wait is deliberately bounded, because a control plane must not block on someone's personal plan
for an unbounded time:

- **Only a reported reset is waited on.** Claude Code reports the reset instant in its rate-limit
  event, and Codex serializes `resets_at` / `reset_after_seconds` alongside the rejection. When
  neither is present the run reports the limit instead of guessing at an interval.
- **`CODE_ZERO_SUBSCRIPTION_LIMIT_WAIT_MS` is a total, not a per-wait allowance.** A reset further
  out than the remaining budget is never waited on; the error propagates with the reset instant
  intact, so a configured fallback still gets its turn and an operator still learns when to return.
  A weekly window is normally far past the default hour, so it fails fast by design.
- **At most two waits per decision.** A third is far more likely to be a transport reporting a
  reset that never arrives than a third window genuinely closing.

Waiting sits _inside_ the fallback: the subscription is already paid for, so a window that reopens
shortly is used before a metered credential is spent.

Session resumption itself is Claude Code only. `codex exec resume <id>` exists in the CLI, but
`ai-sdk-provider-codex-cli` builds a plain `exec` argument vector and exposes no resume setting, so
an interrupted Codex call is reissued after the wait rather than resumed. The waiting behaviour is
identical for both.

To record cost, configure explicit rates; Code Zero never guesses provider pricing:

```yaml
model:
  provider: openai-compatible
  name: gpt-5
  inputCostPerMillionTokens: 1.25
  outputCostPerMillionTokens: 10
```

`observe` is the safe default and never writes files. Proactive pull-request webhooks are ignored until `proactive.enabled` is true. Automatic changes additionally require `mode: fix` or `autonomous`, `autofix.enabled`, sufficient confidence, an allowed change-risk class, repository-native checks, and (by default for proactive, issue, or autonomous work) an isolated runner. High-impact changes always require human approval.

Issue-to-PR work is opt-in twice: `issues.enabled` must be true and the issue must carry the `issues.requireLabel` label, so arbitrary issue text can never start a run. Issue text is untrusted input for the runtime to validate — never instructions. The run first decides from repository evidence whether the issue actually reports a real problem, and (unless `issues.validationComment` is disabled) posts that verdict back on the issue: confirmed with its evidence, not confirmed with every rejection reason, or inconclusive for a human. A pull request is opened only when the run completed, its changes were applied, and every repository check passed. Verified changes are published to a fresh `issues.branchPrefix` branch (never force-updated, never the default branch), and the pull request body is the run's evidence: acceptance criteria, plan, checks, and lifecycle.

---

## Toolchain

- **[aube](https://aube.jdx.dev)** &ndash; package manager, pinned through `packageManager`, reusing the pnpm lockfile and workspace files.
- **[typescript-native-bridge](https://github.com/johnsoncodehk/typescript-native-bridge)** &ndash; overrides `typescript` repo-wide, so `tsc` keeps the classic package surface while the checker runs on tsgo in-process. The override lives in `pnpm-workspace.yaml` and is pinned exactly; the fork only publishes prerelease versions.
- **[Turborepo](https://turborepo.dev)** &ndash; schedules workspace tasks in dependency order and caches tsdown build outputs.
- **[tsdown](https://tsdown.dev)** &ndash; builds publishable packages as ESM and CommonJS with matching declarations and source maps, through the shared [tsdown configuration](./scripts/tsdown.config.ts). The Nuxt dashboard uses the Nuxt build pipeline instead.
- **[Oxlint](https://oxc.rs) + [Oxfmt](https://oxc.rs)** &ndash; type-aware linting and repository-wide formatting, extended with [`@e18e/eslint-plugin`](https://github.com/e18e/eslint-plugin) for modernization, module-replacement, and performance rules.
- **[Knip](https://knip.dev)** &ndash; detects unused files, exports, and dependencies across the workspace as part of `lint:ci`.
- **[`@arethetypeswrong/cli`](https://github.com/arethetypeswrong/arethetypeswrong.github.io) + [Publint](https://publint.dev)** &ndash; validate every package build.
- **[`@redstardev/unplugin-version-injector`](https://www.npmjs.com/package/@redstardev/unplugin-version-injector)** &ndash; replaces the version marker in `@code-zero/shared`; the CLI displays that injected version in its header.

GitHub Actions run typecheck, build/export validation, Oxlint, Oxfmt, tests, and an injected-version smoke test. The manual release-readiness workflow validates artifacts without publishing; package publication remains absent until npm trusted publishing and the `@code-zero` policy are configured.

---

## Security model

The included `LocalRunner` is intended for trusted local development. Production deployments must place it inside Docker, a microVM, or another ephemeral sandbox with CPU, memory, filesystem, and network policies. Only `packages/runner` may invoke shell commands.

Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md). Do not open a public issue.

---

## Agent Skills

Task-specific Agent Skills live in `.skills/` and are exposed to coding agents through `.agents/skills/`. Skilld manages the versioned tsdown skill, and the same portable layout covers architecture, CLI, Turborepo, and safety work:

```bash
aube run skills:list
aube run skills:install
aube run check:repo
```

[AGENTS.md](./AGENTS.md) and [.github/copilot-instructions.md](./.github/copilot-instructions.md) provide concise entry points for coding agents without replacing the human contributor guide.

---

## Open in your editor

Want to contribute without setting up locally? Click any button below to open this project in a cloud development environment:

[![Open in VS Code](https://img.shields.io/badge/Open%20in-VS%20Code-007ACC?style=flat-square&logo=visualstudiocode)](https://vscode.dev/github/wolfstar-project/code-zero)
[![Open in GitHub Codespaces](https://img.shields.io/badge/Open%20in-GitHub%20Codespaces-181717?style=flat-square&logo=github)](https://codespaces.new/wolfstar-project/code-zero)
[![Open in StackBlitz](https://img.shields.io/badge/Open%20in-StackBlitz-1269D3?style=flat-square&logo=stackblitz)](https://stackblitz.com/github/wolfstar-project/code-zero)
[![Open in Gitpod](https://img.shields.io/badge/Open%20in-Gitpod-FFB45B?style=flat-square&logo=gitpod)](https://gitpod.io/#https://github.com/wolfstar-project/code-zero)

---

## Contributing

Please read the [Contributing Guide][contributing] before submitting a pull request, and the architecture and safety rules in [AGENTS.md](./AGENTS.md).

Thank you to all the people who have already contributed to Code Zero!

<a href="https://github.com/wolfstar-project/code-zero/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=wolfstar-project/code-zero" alt="Contributors" />
</a>

---

Apache-2.0 © WolfStar Project.

[contributing]: https://github.com/wolfstar-project/code-zero/blob/main/CONTRIBUTING.md
