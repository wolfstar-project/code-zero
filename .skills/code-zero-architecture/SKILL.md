---
name: code-zero-architecture
description: Use when adding features, moving code, or changing dependencies across Code Zero packages and adapters.
---

# Code Zero architecture

Keep dependency direction explicit while changing the monorepo.

## Package ownership

- `shared`: stable contracts only, plus pure functions over them (evidence rendering, redaction, path predicates).
- `config`: configuration, repository policy, and check discovery. Pure; the agent supplies what it read through the runner.
- `models`: provider-independent model contracts and provider adapters, including the
  subscription transports (`claude-code`, `codex-cli`) that drive a locally logged-in vendor CLI.
  Those spawn a subprocess through their vendor SDK, so they stay behind an exact operator flag,
  import their SDK lazily, and run with the CLI's own file tools disabled. This package still
  contains no `child_process` import of its own: liveness commands are returned as strings for a
  composition root to run through the runner, and `modelFromEnvironment` takes an optional
  `ClaudeCodeProcessSpawner` a composition root backs with `runner`'s `spawnManagedProcess`, so the
  `claude-code` CLI process is spawned through the runner boundary rather than by the vendor SDK's
  own default `child_process.spawn`. `codex-cli` cannot be routed the same way — its vendor SDK
  exposes no equivalent hook — so that one transport's process is always spawned by the vendor SDK
  directly; its read-only sandbox and disabled MCP/approvals are the containment there instead.
- `source-control`: provider-neutral source-control contracts, webhook normalization, capability detection, and the GitHub, GitLab, Bitbucket, and Gitea adapters, including GitHub's issue-to-PR publication (branch and pull-request creation through the Git data API).
- `runner`: command execution and checkout mutation boundary, plus the policy-to-boundary factory.
  Also the only exporter of a live process handle (`spawnManagedProcess`, alongside the bounded
  `execFileProcessRunner`) for an adapter that must hand a real child process to code it does not
  control, such as a CLI-backed model transport's vendor SDK. `spawnManagedProcess`'s optional
  `container` option runs that process in its own container instead of on the host — a deliberately
  different shape from `ContainerRunner`'s repository-command container (`containerizedProcessArgv`
  mounts no checkout and applies no `--network`, since the process it isolates is not a repository
  command and needs the vendor API regardless of `permissions.network`). `env` becomes `-e` flags on
  the engine invocation, not on the engine's own local process — a container's client env sets
  nothing inside the container it starts.
- `agent`: orchestration, the lifecycle machine, and the validation policy.
- `cli`: argument parsing and terminal presentation. Composition-root glue that decides *how* to
  isolate the `claude-code` CLI process lives here (`subscription-isolation.ts`, duplicated
  identically in `api` rather than shared — it needs both `CodeZeroConfig` and an operator
  environment variable, which neither `models` nor `runner` should own). Refuses the transport
  outright when `runner.isolation: container` is declared but no CLI container image is configured,
  rather than falling back to an unisolated host spawn — reported to `modelFromEnvironment` as a
  refusal reason, not by disabling the enable flag, so a configured
  `CODE_ZERO_MODEL_FALLBACK_PROVIDER` still gets a turn. `api` applies the same refusal-reason
  mechanism for a `RunnerPool` lease, which cannot route the CLI's duplex spawn through a
  `SandboxProvider`'s bounded `Runner` contract.
- `database`: Postgres schema, the Drizzle client factory, and checked-in migrations. No policy, and the only package that names a table or opens a connection.
- `auth`: authentication policy and a Better Auth options factory (`authBetterAuthOptions`), plus a
  standalone instance factory (`createAuth`) for callers that own their own secret and origin. Reads
  the store through `database` and never declares a table itself. No HTTP server, no runtime imports.
- `api`: the oRPC router and control-plane operations (task persistence, scheduling). Composes the
  runtime, GitHub, models, and config packages; nothing composes into it, and it does not depend on
  `auth`. Holds no HTTP host of its own.
- `apps/dashboard`: the single deployable app and composition root. A Nuxt app that constructs a
  runner and, from its `server/` directory, serves `packages/api`'s router over `/rpc/**` (RPC) and
  `/api/v1/**` (OpenAPI), and mounts Better Auth in-process at `/api/auth/**` via
  `server/auth.config.ts` (`@onmax/nuxt-better-auth`, full mode, SSR-aware). The only process that
  opens the database, and it does so through `packages/database`. See the `orpc-server` skill.
- `apps/marketing`: frontend-only Nuxt public marketing site. No persistence, credentials, session, or runtime-package dependencies, and nothing imports it. Copy lives in `packages/i18n`, not in the app.

## Workflow

1. Read `AGENTS.md` and `docs/architecture.md`.
2. Identify the narrowest package that owns the behavior.
3. Check imports before adding a dependency. Core packages must not import CLI, HTTP, or source-control adapters.
4. Put a contract in `shared` only when at least two packages need a stable common type.
5. Keep SDK-specific types inside their adapter.
6. Add deterministic tests beside the changed source.
7. Run the affected package checks, then the complete root checks.

## Reject these designs

- Shell execution in a transport adapter, CLI presentation, source-control adapter, model adapter, or agent state machine.
- HTTP request/response types inside the runtime.
- Provider SDK or payload objects passed through shared contracts.
- A generic `utils` package used to bypass ownership decisions.
- Cross-package imports from another package's `src/` directory.
- A capability package importing another capability package. When `runner` needs policy, it declares the fields it needs structurally instead of importing `config`. `auth` depending on `database` is the one sanctioned exception: persistence is a layer beneath policy, and the dependency runs only in that direction.
- A table declared, a connection opened, or a migration written outside `packages/database`.
- Direct filesystem or `child_process` access outside `packages/runner`, including in the agent's discovery step.
- A second place that decides whether a run may write, or whether a run is verified. Both have exactly one home.
