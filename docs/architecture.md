<!--
The #region markers below let the docs site (apps/docs) include individual
sections of this file, so the site and this canonical document never diverge.
Keep them wrapping their sections when editing.
-->

<!-- #region intro -->

# Architecture

Code Zero is organized as a dependency-directed monorepo. The core decides what should happen; adapters decide how external systems communicate with it; the runner controls what is allowed to happen to a checkout.

```text
Source-control adapters ─┐
CLI adapter ─────────────┼──> agent runtime ──> runner boundary ──> isolated checkout
packages/api ────────────┘        │
                         ├──> model abstraction ──> provider
                         └──> shared contracts

apps/dashboard: UI + packages/api's router (oRPC + OpenAPI) + Better Auth ──> database package ──> Postgres
Nuxt marketing ───> public site (no inbound dependencies)
```

<!-- #endregion intro -->

<!-- #region dependency-direction -->

## Dependency direction

- `shared` contains stable data contracts and must not import feature packages.
- `config`, `models`, `source-control`, and `runner` implement focused capabilities around shared contracts.
- `agent` composes policies and state transitions without knowing HTTP or terminal details.
- `cli` is an entry-point adapter. It may depend on the runtime, but the runtime must not depend on it.
- `database` owns the schema, the Drizzle client, and the migrations. It is the only package that talks to Postgres, and it holds no policy.
- `auth` holds authentication policy and a Better Auth options factory, and reads the store through `database`. It does not depend on the runtime.
- `packages/api` composes the runtime, source-control, models, and config adapters into one router. It may depend on all of them; none of them may depend on it. It does not depend on `auth`.
- `apps/dashboard` is the entry-point adapter and composition root: a Nuxt app whose `server/` directory serves `packages/api`'s router and, through its own `server/auth.config.ts` composing `packages/auth`'s options, is the only process that opens the database, through `packages/database`.
- `apps/marketing` is a frontend-only Nuxt site with no dependents and no dependencies beyond `packages/i18n`. Nothing may import it.

If a change creates a reverse dependency, move the shared contract inward instead of importing an adapter into the runtime.

<!-- #endregion dependency-direction -->

<!-- #region execution-boundary -->

## Execution boundary

Only `packages/runner` may execute commands or mutate a target repository at runtime. The boundary is responsible for validating working directories, arguments, timeouts, output limits, and execution mode. A transport handler, source-control adapter, model provider, or state transition must request runner work through typed contracts rather than invoking a shell directly.

`observe` is the default mode. It can inspect and report but cannot write. Enabling `fix` requires both an explicit mode and repository policy permission.

`RepositoryBoundary` holds the filesystem and git behavior shared by every runner; subclasses decide only how a repository command is executed. `LocalRunner` runs it on the host, `ContainerRunner` runs it in an ephemeral sandbox. Both report a `RunnerDescription` that is recorded in evidence, so a claim of isolated verification is auditable rather than assumed.

Git inspection runs in the trusting process because its argv is fixed by the runner package. Repository-supplied commands are the untrusted ones, and those are what isolation moves into a sandbox.

`createRunner` and `runnerOptionsFromPolicy` are the only mapping from policy to a concrete boundary. `runnerOptionsFromPolicy` declares the policy fields it needs structurally, so the runner does not depend on the configuration package. Composition roots call both; nothing else constructs a runner.

Hosted sandboxes follow the same rule. `RunnerPool` lives in `packages/runner`, accepts credential-free `SandboxRequest` values, enforces global/repository quotas and lease ceilings before provisioning, and returns only a `Runner`. Provider credentials are constructor state of a vendor adapter and never enter a request, lease snapshot, agent state, or log. A composition root may schedule and release a lease, but it cannot execute a command itself.

Model transports follow the same adapter rule. `packages/models` owns the AI SDK integrations for OpenAI, Anthropic, Google, AI Gateway, and OpenAI-compatible endpoints behind one `ModelProvider` contract. Composition roots pass the validated provider policy; credentials come only from fixed provider-specific environment variables, and a custom endpoint can only come from the operator-owned `CODE_ZERO_MODEL_BASE_URL` environment variable. The agent runtime sees neither SDK objects nor credentials, and all adapters share one structured-output, usage-accounting, timeout, and error-redaction path.

Two of those transports are subscription-based: `claude-code` and `codex-cli` drive a vendor CLI that is already logged in on the host, so `modelProviderCredentialKind` reports `subscription` and there is no credential for a composition root to supply, redact, or persist. They are the only transports whose SDK spawns a subprocess, which is why three things hold: each stays inert unless its operator flag is exactly `true`, the vendor SDK is imported lazily so an unused transport costs nothing, and the CLI is configured with its own tools disabled (Claude Code) or read-only with approvals off (Codex) so it cannot read outside the supplied context or edit a checkout behind the runner boundary.

`packages/models` still contains no `child_process` import of its own — it never spawns anything itself, matching every other package outside `packages/runner`. `subscriptionProbeCommand` returns the liveness command as a string for `zero doctor` to run through the runner like every other command, and the CLI process behind a live `decide()` call is spawned the same way: `modelFromEnvironment` takes an optional `ClaudeCodeProcessSpawner`, and `packages/cli` and `packages/api` supply one backed by `packages/runner`'s `spawnManagedProcess` — the streaming counterpart to `execFileProcessRunner`, for a caller that needs a live duplex process instead of one buffered result. Wired that way, the `claude-code` transport's CLI process is spawned through the same boundary as every repository check, not through the vendor SDK's own default `child_process.spawn`. `codex-cli` cannot be closed the same way: `ai-sdk-provider-codex-cli` exposes no equivalent spawn hook, so that transport's process is spawned by the vendor SDK directly regardless of what a composition root supplies — a vendor limitation, not a choice this codebase makes. The same read-only, no-MCP, approvals-off configuration is still the containment for that one transport.

Both composition roots additionally read `config.runner.isolation` to decide how they build that spawner, in a local module (`subscription-isolation.ts`, duplicated in `packages/cli` and `packages/api` rather than pulled into a shared package — this decision is composition-root-specific, needing both `CodeZeroConfig` and an operator environment variable, and neither `packages/models` nor `packages/runner` should own it). On `local` isolation it wires `spawnManagedProcess` directly, spawning the CLI on the host, same as before. On `container` isolation it wires `spawnManagedProcess`'s `container` option instead: `packages/runner` exports `ManagedProcessContainerOptions` and `containerizedProcessArgv`, a `docker`/`podman run` invocation deliberately distinct from `ContainerRunner.engineArguments()` — no repository-checkout volume (the CLI never touches one) and no `--network` tied to `permissions.network` (that policy contains an _untrusted checkout's_ commands, not Code Zero's own necessary calls to the vendor API). When container isolation is declared but no CLI container image is configured (`CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE`), the composition root refuses the transport rather than silently falling back to an unisolated host spawn. The refusal is reported to `modelFromEnvironment` as a `subscriptionRefusalReason` — a synchronous throw from Code Zero's own code the moment the transport is asked to build a model, never touching the vendor SDK — rather than by turning the enable flag off: the flag also gates fallback selection, so disabling it would have reported the transport as never configured at all and skipped a configured `CODE_ZERO_MODEL_FALLBACK_PROVIDER` entirely, turning a run that could have degraded into one that fails outright. `environmentForModel` (used only by `zero doctor`'s diagnostics, which want a plain "not ready" signal rather than this nuance) is the one place that still disables the flag.

A `RunnerPool` lease is a separate isolation mechanism from `config.runner.isolation`, and `SandboxProvider` (`vitehub`/`cloudflare`/`vercel`/`custom`) returns only the ordinary `Runner` contract — bounded command execution, never a live process handle — so there is no `claude-code` spawner that could route the CLI's duplex stream through the same boundary a lease already gives repository commands. `runTask` (`packages/api/src/operations.ts`) refuses `claude-code` outright whenever `options.runnerPool` is configured, regardless of `runner.isolation`, the same way it refuses container isolation without an image and for the same reason: a `subscriptionRefusalReason`, not a disabled flag, so a configured fallback still gets its turn rather than the run failing outright. `packages/cli` has no `RunnerPool` concept at all, so this check lives only in `packages/api`.

Getting an authenticated session into that container took three fixes beyond the mount, each verified against a real `docker run` rather than assumed: the vendor SDK resolves the CLI to an absolute host path (its bundled native binary, or `CODE_ZERO_CLAUDE_CODE_PATH`) that does not exist in the container, so the spawner substitutes a bare, image-relative executable name instead (`CODE_ZERO_CLAUDE_CODE_CONTAINER_EXECUTABLE`, default `claude`) and passes the vendor's own args through unchanged (they carry no host paths). The CLI's session spans two host locations that are not nested — `~/.claude/` and a sibling file `~/.claude.json` — and Docker refuses to bind-mount a file inside an already-`:ro` directory mount (an OCI runtime restriction, not a policy choice here), so both are mounted as siblings under one synthetic directory with the container's `$HOME` pointed at it, letting the CLI's own default resolution find both without a `CLAUDE_CONFIG_DIR` override. And the container runs as the host's UID:GID rather than `root`: the mounted credential file's `0600` mode plus `--cap-drop ALL` (which strips even `root`'s permission-bypass capability inside the container) means only a matching UID can satisfy the CLI's own ownership check on it. `containerizedProcessArgv` also forwards `env` as `-e KEY=VALUE` flags now — the container engine's own process env configures its client, not the process it starts, so `$HOME` and the vendor SDK's other env entries would otherwise never reach the code running inside.

A subscription transport also owns the one failure that repairs itself. A spent usage window is not a permanent error, so `ResumingSubscriptionProvider` waits for the reset the transport reported and retries, resuming the interrupted session through a `SubscriptionSession` handle shared by the model factory that writes to it and the error translator that reads it. The wait is bounded by a cumulative budget and an attempt count, and only ever on a reset the transport actually stated, so no run blocks for a duration nobody chose. It sits inside the API-key fallback rather than outside it: the subscription is already paid for. Both wrappers degrade on `SubscriptionProviderUnavailableError` and nothing else, so a model that merely returned an unusable decision never causes a transport to be swapped or a run to sleep.

<!-- #endregion execution-boundary -->

<!-- #region api-package -->

## API package

`packages/api` is the library `apps/dashboard`'s server reads from: it composes the agent runtime, source-control adapter, model abstraction, and config into one typed oRPC router (`health`, `tasks.list`, `tasks.get`, `tasks.create`, `approvals.decide`, `audit.list`) and a control-plane operations layer (`runTask`, `TaskScheduler`, `TaskStore`). It holds no HTTP host of its own and does not depend on `packages/auth` — `apps/dashboard/server/` is the only place that constructs a transport handler from it, which keeps the router and its authorization rules identical regardless of which wire protocol serves a given request.

Procedures validate at the boundary with Zod and then delegate; they never invoke a shell or touch a checkout, because `runTask` is the only place that resolves policy and constructs a runner. A hosted `RunnerPool` lease is optional and still yields nothing but a `Runner`. `EvlogHandlerPlugin`, shared by every transport through one `AsyncLocalStorage`-backed logger (`packages/api/src/orpc/logging.ts`), attaches structured request logs; procedures read it defensively (`requestLoggerStorage?.getStore()?.set(...)`) so router tests that call procedures directly through `createRouterClient`, without a transport's plugin attached, still pass.

<!-- #endregion api-package -->

<!-- #region marketing-boundary -->

## Marketing boundary

`apps/marketing` is the public site and holds the weakest position in the graph: no persistence, no credentials, no session, and no runtime-package imports. It links to the dashboard by origin rather than importing anything from it, so the two deploy and fail independently.

It differs from the dashboard in exactly one respect. The dashboard renders with SSR because its session cookie is scoped to its own origin, so the server resolves it directly from the incoming request; the marketing site renders on the server too, but for a different reason — being crawlable is the entire point of it, so it prerenders every route rather than depending on a live request. That gives it a Nitro server, but the only routes on it are the ones `@nuxtjs/seo` generates — `robots.txt` and the sitemaps. Anything that needs to read or write state belongs behind the dashboard's `server/` routes, not here.

<!-- #endregion marketing-boundary -->

<!-- #region dashboard-boundary -->

## Dashboard and control-plane boundary

`apps/dashboard` is the composition root and the only entry-point adapter with HTTP capability: a Nuxt app whose `server/` directory hosts

| Route          | Purpose                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `/rpc/**`      | `packages/api`'s router over the typed oRPC RPC transport                                                    |
| `/api/v1/**`   | The same router over OpenAPI/REST (`OpenAPIHandler`); docs at `/api/v1/docs`, spec at `/api/v1/openapi.json` |
| `/api/auth/**` | The Better Auth handler, mounted by `@onmax/nuxt-better-auth` from `server/auth.config.ts`                   |

`/rpc/**` and `/api/v1/**` serve the exact same `rpcRouter` and therefore the exact same authorization rules; only the wire protocol differs. `.meta(openapi(...))` metadata on each procedure (method, path, tags) exists purely for the OpenAPI transport and has no effect on the RPC transport — it is attached through a real, regularly-imported function rather than the `@orpc/openapi` package's alternative bare side-effect import, because Nitro's production bundler tree-shakes an unused side-effect import away even though the package's own `sideEffects` field marks it as one to keep.

Mutations fail closed behind operator-issued bearer credentials (`CODE_ZERO_CONTROL_PLANE_TOKENS`, comma-separated `name:token` pairs). `tasks.create` additionally requires the target repository path to appear in `CODE_ZERO_CONTROL_PLANE_REPOSITORIES`, so an HTTP caller cannot point a run at an arbitrary server-local path, and the requested execution mode to be granted to the principal via `CODE_ZERO_CONTROL_PLANE_MODES` (comma-separated `name:mode|mode` grants; without one a principal is limited to the non-writable `observe` and `suggest` modes). Approval decisions record the authenticated principal's name rather than a wire-supplied actor. Reads stay open for the dashboard. This bearer-token scheme is independent of the Better Auth session that protects the dashboard UI itself.

Task persistence is a narrow `KeyValueStorage` contract adapted over the ViteHub KV Runtime Helper (`apps/dashboard/nuxt.config.ts` registers `vite-hub/nuxt`, composing ViteHub into Nuxt's own Nitro build), so the filesystem driver, Cloudflare KV, Deno KV, or Upstash stays interchangeable. Records are redacted on the way in and hold no review input and no checkout path, so task history cannot become a credential or filesystem leak. `TaskScheduler` bounds concurrency globally and per repository, and rejects work once the queue is exhausted rather than growing without limit.

Transport concerns stop at the route handlers: headers, status mapping, and request objects never reach a runtime package.

<!-- #endregion dashboard-boundary -->

<!-- #region issue-to-pr -->

## Issue-to-PR workflow

A scoped GitHub issue can become a verified, review-ready pull request without ever widening the runtime's authority. The entry point is the same authenticated webhook path: an `issues` event is parsed in `packages/source-control` and produces a task only when repository policy has opted in (`issues.enabled`) and the issue carries the `issues.requireLabel` label, so arbitrary issue text can never start a run. The issue's title and body travel to the runtime as bounded, untrusted feedback with trigger `issue` — data to validate, never instructions — and the run mode comes only from repository policy, never from the wire.

The run itself is the ordinary lifecycle. During planning the model records verifiable acceptance criteria for the issue alongside its plan; the runtime bounds them and carries them into the task result and evidence bundle. Writes still require an explicit write mode, `autofix.enabled`, confidence, an allowed change-risk class, and — by default, like proactive work — an isolated runner. High-impact changes stop at `needs-human` exactly as before.

The validation verdict is reported back where the work was requested. Unless `issues.validationComment` is disabled, a finished run posts one comment on the issue, composed by `prepareIssueValidationComment` from the persisted evidence alone: **confirmed** when repository evidence supports the report, **not confirmed** with every rejection reason when it does not, **inconclusive** when a human should decide. A run that failed before reaching a verdict posts nothing rather than something misleading, and the `GitHubIssueComments` adapter can only add a comment — it has no path to label, edit, or close an issue. The comment claims a fix exists only when the run was actually verified.

Publication has a single home: `prepareIssuePullRequest` in `packages/source-control` decides whether a finished run has earned a pull request, and composes it when it has. It refuses any run that is not `completed`, not `accepted`, not verified by the repository's own checks, changed no files, or proposes a high-impact change, so a pull request can never claim success its evidence does not support — the body _is_ the rendered evidence, including the acceptance criteria. The composition root in `apps/dashboard` then reads the verified file contents through a read-only runner and hands them to the `GitHubPullRequests` adapter, which publishes them as a commit on a fresh `issues.branchPrefix` branch through the Git data API and opens the pull request against the default branch. The branch name is assembled only from operator policy, the issue number, and the task identifier; an existing ref is never force-updated; and the default branch is never committed to. A failed publication never fails the run — the evidence is already persisted — it is reported as the reason no pull request exists.

<!-- #endregion issue-to-pr -->

<!-- #region authentication-boundary -->

## Authentication boundary

Authentication follows the same adapter rule at the package level, but not at the process level: Better Auth is mounted in-process by `apps/dashboard`'s `/api/auth/**` route (`server/auth.config.ts`), the only route in the app that resolves `packages/auth`'s environment options — including the connection string, through `packages/database` — and the signing secret (`NUXT_BETTER_AUTH_SECRET`, required in production; `BETTER_AUTH_SECRET` only works as a development fallback) and therefore the only part of the app that opens a connection to Postgres, the only database in the repository. Every other route reaches storage exclusively through the `KeyValueStorage` contract. `packages/auth` holds the policy: `authBetterAuthOptions` builds the database, policy, and provider options Better Auth needs, deliberately omitting `secret`, `baseURL`, and `trustedOrigins` so the `@onmax/nuxt-better-auth` module — which resolves those itself and constructs the actual instance — cannot diverge from it. `createAuth`, which does build a full standalone instance, remains for callers that own their own secret and origin, such as the Better Auth CLI's schema-generation entry point; nothing in `apps/dashboard`'s request path uses it. `packages/auth`'s `./config` subpath stays free of database dependencies so the login page can read feature flags without bundling one.

Invitations (`AUTH_ENABLE_INVITATIONS`) are the Better Enrollment plugin, composed by the same factory and under the same rule: `packages/auth` decides policy and declares delivery structurally, and `apps/dashboard`'s `server/auth.config.ts` binds `packages/mail` to it. The plugin's mode is auto-detected from the sign-up policy rather than configured a second time — with `AUTH_ENABLE_SIGNUP` off every sign-up route is closed and invitations are the only way in, and with it on they degrade to role and organization grants — so the two cannot drift apart. Enabling Better Enrollment fails startup without both a mail transport and a dashboard origin: a private invitation's link is deliberately never returned to whoever created it, so email is the only path the token travels, and an undeliverable invitation reaches nobody at all rather than failing loudly. Better Auth's separate organization plugin has no mail-delivery callback in this composition and does not depend on the dashboard origin. A public invitation still returns its shareable link once from create or resend, while Better Enrollment's `sendPublicInvitation` callback also sends the inviter a durable copy when it has an attributable email address; headless system invitations without one keep relying on the returned link. Every Better Enrollment link points at one path, `/invite?token=`, because what the redemption page must render is decided by the auth server when it reads the token; encoding the invitation's kind in the URL would both duplicate that decision and disclose it to anyone the link is forwarded to. That page renders whichever form the server's `nextAction` names and submits only the fields its `requiredFields` asks for, so one page covers private and public invitations, app and organization ones, and both modes. It is the one authenticated-surface route with no `auth` route rule: requiring a session would turn away the signed-out invitee it exists for, and requiring a guest would turn away the signed-in one accepting an organization invitation. Redemption deliberately does not start a session, so a newly created account is handed to the sign-in page with the credentials it just set — for a private invitation the page never learns the full address anyway, since `invite.get` returns it masked.

The app-wide `user.role` column belongs to this boundary too, and is distinct from `member.role`, which scopes a role to a single organization. Better Auth keeps multiple app-wide roles in one comma-separated string, and only invitation redemption merges into it; any other write replaces the whole set, so code that changes a role has to send the full set or it silently revokes the rest.

The dashboard renders with SSR. The session cookie is scoped to the app's own origin, so the server resolves it directly from the incoming request before the first paint, rather than rendering a signed-out shell that a client-side check then corrects.

<!-- #endregion authentication-boundary -->

<!-- #region persistence-boundary -->

## Persistence boundary

Postgres has one owner: `packages/database`. It declares the tables in Drizzle (`src/schema/`), opens the connection pool (`src/client.ts`), and keeps the migrations as reviewable, checked-in SQL under `drizzle/`. Nothing else constructs a client or names a column.

The split from `packages/auth` is the same rule applied one level down. Authentication policy and the store it happens to use change for different reasons and are reviewed by different eyes: `packages/database` knows nothing about sign-in, sessions, or invitations beyond the shape of the rows, and `packages/auth` states what is allowed and hands `drizzleAdapter` a client it did not open. The dependency runs one way, and `packages/database` must never import `packages/auth`.

Declaring the schema here rather than letting Better Auth's own migration CLI generate it is what makes `user`, `session`, `account`, and `verification` diffable like any other change. Column names are load-bearing: the Better Auth adapter maps its models by name, so a rename that type-checks can still break sign-in at runtime. Migrations are generated (`db:generate`) and applied (`db:migrate`) from the database package alone, and `createDatabase` is a factory rather than a module-level singleton so importing the package never opens a socket — the composition root owns the pool's lifetime.

`DATABASE_URL` is the connection string a deployment sets. `AUTH_DATABASE_URL` is still accepted, because the store used to live inside `packages/auth` and a deployment configured before the split must not fail to start on upgrade.

The same rule covers the tables a Better Auth plugin brings with it. `invite` and `invite_use` (Better Enrollment) are declared here alongside `organization` and `member`, so a deployment that never enables the feature still migrates them and simply never writes to them — the alternative is a schema that depends on which flags were set when the migration ran. Two of their columns are deliberate exceptions to the repository's usual habits: an accepted invitation is a permanent audit record, so it carries no foreign key to the organization, team, or account it names and denormalizes `inviter_name`/`inviter_email` in order to survive their deletion; and `invite_use` carries only `used_at` rather than the shared timestamp pair, because a use is a point-in-time fact that must not look rewritable.

<!-- #endregion persistence-boundary -->

<!-- #region state-transitions -->

## State transitions

The lifecycle is:

```text
discover -> understand -> validate -> plan -> execute -> verify -> review
                                      ^                    |
                                      └────── repair ──────┘
```

`LifecycleMachine` in `packages/agent` holds the transition table and refuses any move it does not define, so an implementation mistake becomes a thrown error rather than an unverified result that looks finished. Notably, `executing` cannot reach `completed` without passing through `verifying`, and `planning` cannot skip to `reviewing`. Every non-terminal state can reach `failed`.

Each stage owns one decision:

- **discover** collects the checkout, its working-tree or pull-request base-to-head diff, and its native check commands through the runner.
- **understand** asks the model to interpret untrusted feedback, proactively inspect the complete diff, or interpret an issue task in repository context.
- **validate** decides the verdict from repository evidence, never from the reviewer's or the model's assertion.
- **plan** records the plan and resolves authorization. Each refusal is a distinct reportable outcome rather than a silent downgrade.
- **execute** applies changes restricted to the validated scope, through the runner.
- **verify** runs the repository's own checks and captures their output.
- **review** inspects the resulting diff before a run may call itself complete.

Repair re-enters `plan` with the failing output as context, until `agent.maxAttempts` is spent.

Proactive review is repository opt-in. Its model decision carries severity, confidence, cited evidence, affected files, and a change-risk classification. The runtime validates the evidence independently, then requires confidence and repository policy to allow the risk class. High-impact changes always stop at `needs-human`; proactive or autonomous writes use an isolated runner when policy requires it.

<!-- #endregion state-transitions -->

<!-- #region verdicts-and-evidence -->

## Verdicts and evidence

Validation lives in `packages/agent/src/validation.ts` and is independent of any provider. It rejects a claim that cites no evidence, names no existing file, or quotes repository content that is not there; it reports a supported but low-confidence claim as inconclusive. Rejection reasons are collected in full rather than short-circuiting on the first, because the report is the product.

`TaskResult.verified` is derived in exactly one place, at the point a run produces its terminal result: it requires a completed state, an applied change, and every executed check passing. No branch can assert verification it did not earn, which is what makes "a failed verification is never presented as success" a property of the code rather than a convention.

`EvidenceBundle` and its Markdown renderer live in `packages/shared` because both the source-control adapters and the CLI consume them, and because rendering is a pure function over contracts with no I/O. Terminal states map deterministically onto a provider-neutral run outcome in `packages/source-control`, which each provider adapter translates into its own status vocabulary — explicitly noting any conclusion the platform cannot express (see `docs/source-control-providers.md`).

<!-- #endregion verdicts-and-evidence -->

<!-- #region adding-a-capability -->

## Adding a capability

1. Put stable input/output types in `shared` only when multiple packages need them.
2. Add the capability to the narrowest package.
3. Keep external SDK types behind the relevant adapter.
4. Add deterministic unit tests, including failure and policy cases.
5. Expose it through the CLI or a dedicated transport adapter only after the runtime contract is stable.

<!-- #endregion adding-a-capability -->
