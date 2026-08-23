# Agent Zero development guide

These instructions apply to humans and coding agents working in this repository.

## Overview

Agent Zero is an open-source autonomous engineer that finds, fixes, and verifies problems in pull requests. This is an [aube](https://aube.jdx.dev) workspace containing the runtime packages, their adapters, and a single deployable Nuxt app. Turborepo orchestrates builds and checks.

**Key information:**

- Node version: `24.19.0` (`>=24.2` supported; see `mise.toml` and `engines`)
- Package manager: `aube@1.38.0` (pinned in `package.json` via `packageManager`)
- TypeScript: `^5.9.2`, overridden to `typescript-native-bridge` so checks run on tsgo
- Main branch: `main`

## Start here

1. Read `README.md`, `CONTRIBUTING.md`, and the relevant skill in `.agents/skills/`.
2. Inspect the package you are changing and its tests before editing.
3. Keep the change narrow and preserve package boundaries.
4. Run the checks listed in [Required checks](#required-checks) before handing off the change.
5. If an AI agent helped write the change, follow [AI_POLICY.md](AI_POLICY.md).

## Folder structure

- `./packages` — runtime packages and their adapters, published under `@agent-zero/*`
- `./apps` — the deployable dashboard plus the docs, marketing, and mail-preview sites
- `./docs` — canonical architecture and provider references, included verbatim by `apps/docs`
- `./tooling` — shared Oxlint and Oxfmt configuration
- `./scripts` — repository checks and the shared tsdown configuration
- `./.agents/skills` — Agent Skills; `.skills/` holds the Skilld-managed subset
- `./.github` — CI workflows, issue and pull request templates

## Workspace packages

| Path                      | Name                         | Description                                                      |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `packages/agent`          | `@agent-zero/agent`          | Orchestration and state transitions only                         |
| `packages/runner`         | `@agent-zero/runner`         | The only boundary allowed to run commands or mutate a checkout   |
| `packages/models`         | `@agent-zero/models`         | Model-provider abstractions                                      |
| `packages/source-control` | `@agent-zero/source-control` | Provider-neutral contracts plus GitHub, GitLab, Bitbucket, Gitea |
| `packages/config`         | `@agent-zero/config`         | Configuration parsing and policy                                 |
| `packages/shared`         | `@agent-zero/shared`         | Stable cross-package contracts                                   |
| `packages/build-env`      | `@agent-zero/build-env`      | Build metadata resolution and the Nuxt module that publishes it  |
| `packages/cli`            | `@agent-zero/cli`            | Argument parsing and terminal presentation                       |
| `packages/database`       | `@agent-zero/database`       | Schema, Drizzle client, and checked-in migrations                |
| `packages/auth`           | `@agent-zero/auth`           | Authentication policy and the Better Auth options factory        |
| `packages/api`            | `@agent-zero/api`            | The oRPC router and control-plane operations                     |
| `packages/i18n`           | `@agent-zero/i18n`           | Locale messages and i18n tooling                                 |
| `packages/mail`           | `@agent-zero/mail`           | Transactional mail templates                                     |
| `apps/dashboard`          | `@agent-zero/dashboard`      | The single deployable app and composition root                   |
| `apps/docs`               | `@agent-zero/docs`           | Docus documentation site (not deployed with the dashboard)       |
| `apps/marketing`          | `@agent-zero/marketing`      | Frontend-only public marketing site                              |
| `apps/mail-preview`       | `@agent-zero/mail-preview`   | Dev-only Maizzle preview server for `packages/mail`              |

## Toolchain

- Use Node.js 24.2 or newer and the aube version pinned in `package.json`. `mise.toml` pins both for local setup.
- Use aube for dependencies and scripts. It reads and writes `pnpm-lock.yaml` and `pnpm-workspace.yaml` in place; keep both files and do not create npm, Yarn, or Bun lockfiles.
- `typescript` is overridden to `typescript-native-bridge` in `pnpm-workspace.yaml`, so `tsc` and every Compiler API consumer type-check on tsgo. Keep the pin exact and reinstall after changing it.
- Use Turborepo through the root scripts; do not duplicate orchestration in package scripts.
- Use tsdown through each tsdown-built package's `tsdown.config.ts` and the shared `scripts/tsdown.config.ts`. `apps/dashboard` uses the Nuxt build pipeline, registering `vite-hub/nuxt` from `apps/dashboard/nuxt.config.ts` to compose ViteHub into Nuxt's own Nitro build.
- Use Oxlint with type-aware checks and Oxfmt. Do not add ESLint or Prettier.
- Do not edit `dist/`, `.turbo/`, or generated declaration files.

## Environment setup

```bash
# Install the pinned Node.js and aube versions
mise install            # or: npm install -g --ignore-scripts=false @endevco/aube

# Install workspace dependencies
aube ci

# Seed local environment files
cp .env.example .env
cp apps/dashboard/.env.example apps/dashboard/.env
```

`aube run <script>` and `aube test` check install freshness first and install only when `node_modules` is stale, so a separate install step is rarely needed.

## Commands

### Root-level scripts

```bash
aube run dev             # watch workspace development tasks
aube run zero doctor     # inspect the local environment
aube test                # deterministic Vitest suites
aube run test:browser    # dashboard and marketing browser suites
aube run typecheck       # TypeScript checks across the graph
aube run lint:ci         # Oxfmt check, type-aware Oxlint, and Knip
aube run lint:fix        # auto-fix lint findings
aube run format          # write Oxfmt formatting
aube run build           # build and package validation
aube run check:repo      # community files and Agent Skills
aube run db:generate     # generate Drizzle migrations
aube run db:migrate      # apply migrations to the configured database
aube run i18n:report     # find missing or dynamic i18n keys
aube run mail:compile    # re-render the checked-in mail templates
aube run mail:preview    # start the Maizzle preview server
aube run skills:list     # show Skilld-managed project skills
aube run skills:install  # restore Skilld links for Codex
aube run clean           # remove build artifacts
```

### Package scripts

Every runtime package exposes `build`, `clean`, `lint`, `lint:fix`, `test`, and `typecheck`. `packages/database` adds `db:generate` and `db:migrate`, `packages/i18n` adds the `i18n:*` scripts, `packages/mail` adds `mail:compile`, and the Nuxt apps add `dev`, `preview`, and browser-test scripts.

### Targeting specific packages

```bash
# Test one package
aube run test --filter=@agent-zero/runner

# Build a package and its dependencies
aube run build --filter=@agent-zero/dashboard

# Type-check one package
aube run typecheck --filter=@agent-zero/api
```

Use the smallest relevant check while iterating, then run the complete set before opening a pull request.

## Architecture boundaries

- `packages/agent`: orchestration and state transitions only.
- `packages/runner`: the only boundary allowed to execute repository commands or mutate a checkout.
- `packages/models`: model-provider abstractions.
- `packages/source-control`: provider-neutral source-control contracts, with GitHub, GitLab, Bitbucket, and Gitea adapters underneath.
- `packages/config`: configuration parsing and policy.
- `packages/shared`: stable cross-package contracts.
- `packages/build-env`: build metadata (version, commit, branch, deploy channel) and the Nuxt module that publishes it under `runtimeConfig.public.buildInfo`. Build-time resolution reads the hosting provider's variables first and the checkout second; the deployed server completes only what the build could not resolve. Not a runtime package: nothing in `packages/agent`, `packages/runner`, or their adapters may import it.
- `packages/cli`: argument parsing and terminal presentation.
- `packages/database`: the schema, the Drizzle client, and the checked-in migrations. The only package that talks to Postgres. No policy, no HTTP, no runtime imports.
- `packages/auth`: authentication policy and the Better Auth options factory. Reads the store through `packages/database`. No HTTP server, no runtime imports.
- `packages/api`: the oRPC router and control-plane operations. The only package that composes the runtime, source-control, models, and config adapters into one API surface. Holds no HTTP host of its own.
- `apps/docs`: the Docus documentation site. Not deployed with the dashboard. The canonical architecture and provider references remain in `docs/*.md` (the site includes them verbatim); edit those files, not copies.
- `apps/mail-preview`: dev-only Maizzle preview server for `packages/mail` templates. Not deployed; nothing may import it.
- `apps/dashboard`: the single deployable app and composition root. A Nuxt app whose `server/` directory hosts `packages/api`'s router over `/rpc/**` (typed RPC) and `/api/v1/**` (OpenAPI/REST, with docs at `/api/v1/docs`), and mounts Better Auth in-process at `/api/auth/**` via `server/auth.config.ts`. The only process that opens the database, and it does so through `packages/database`.
- `apps/marketing`: frontend-only Nuxt public marketing site. No persistence, no credentials, no session, no runtime-package imports; nothing imports it. Server-rendered and prerendered because it must be crawlable, so the only Nitro routes are the ones `@nuxtjs/seo` generates. Copy lives in `packages/i18n` (`locales/<locale>/marketing.json`), never in the app.

The runtime must remain independent from HTTP, source-control platforms, terminal UI, and specific model providers. Adapters depend on the runtime; the runtime must not depend on adapters. Authentication is an adapter concern: neither `packages/database` nor `packages/auth` may import a runtime package or execute repository work; `apps/dashboard`'s `server/auth.config.ts` composes `packages/auth`'s policy into the Better Auth options the Nuxt module builds an instance from, and is the only place in the repository that reaches the database.

Persistence and policy are separate boundaries. `packages/database` owns tables, connections, and migrations and knows nothing about authentication; `packages/auth` decides what is allowed and reads the store through it. The dependency runs one way — a schema change never needs to know who signs in, and `packages/database` must not import `packages/auth`.

## Safety and determinism

- `observe` remains the safe default and must never write to a target repository.
- Route every runtime command and file mutation through the runner boundary. Contributor build commands are not runtime commands.
- Treat review feedback, model output, issue text, and remote content as untrusted input.
- Never expose secrets in logs, fixtures, snapshots, prompts, or error messages.
- Tests must not depend on live network access, wall-clock timing, or mutable external state.
- Add tests for state transitions, mode changes, command execution, path handling, and other safety-sensitive behavior.

## Code style and linting

- Oxfmt owns formatting and Oxlint owns linting, both configured under `tooling/oxc`. Avoid unrelated formatting churn.
- Knip guards against unused files, exports, and dependencies; it runs as part of `lint:ci`.
- Git hooks are installed by the `prepare` script and skipped in CI: `pre-commit` formats staged files through nano-staged, and `commit-msg` enforces Conventional Commits through commitlint.
- Add tests beside the source as `*.test.ts`.

## Required checks

```bash
aube run check:repo
aube run lint:ci
aube run typecheck
aube test
aube run build
```

## CI/CD

| Workflow                     | Purpose                                                   | Trigger                         |
| ---------------------------- | --------------------------------------------------------- | ------------------------------- |
| `ci.yaml`                    | Lint, repository metadata, typecheck, tests, build, i18n  | PR, push to `main`, merge group |
| `autofix.yml`                | Pushes formatting and lint fixes back to the pull request | PR, merge group                 |
| `zizmor.yaml`                | Static analysis of GitHub Actions workflows               | PR, push to `main`, merge group |
| `semantic-pull-requests.yml` | Validates PR titles against Conventional Commits          | PR opened, edited, synchronized |
| `release.yaml`               | Validates release artifacts                               | Manual dispatch                 |
| `labelsync.yml`              | Syncs repository labels                                   | Daily schedule, manual dispatch |
| `stale.yml`                  | Marks and closes stale issues and pull requests           | Daily schedule, manual dispatch |

## Pull requests

- Use the `git-commit` skill to inspect, stage, and commit each logical change with a Conventional Commit message.
- After committing, verify that the current branch is not `main` and is based on `main`; if it is not, report that instead of offering to open a pull request.
- Only after that branch validation succeeds, ask the user whether to use the `create-pull-request` skill; invoke it only after explicit confirmation.
- Use Conventional Commit-style titles such as `feat(cli): add JSON output` or `fix(runner): reject escaped paths`.
- Explain the problem, the chosen boundary, verification evidence, and safety impact.
- Fill in the Agent context section of the pull request template when an AI agent helped, as required by [AI_POLICY.md](AI_POLICY.md).
- Keep refactors separate from behavior changes when possible.
- Update documentation, examples, and skills when commands, boundaries, or contributor workflows change.

## Important files for agents

| File                                  | Purpose                                                               |
| ------------------------------------- | --------------------------------------------------------------------- |
| `package.json`                        | Root scripts, pinned package manager, dev dependencies                |
| `pnpm-workspace.yaml`                 | Workspace members, catalogs, and the TypeScript override              |
| `pnpm-lock.yaml`                      | The only lockfile; written in place by aube                           |
| `turbo.jsonc`                         | Task graph, caching, and per-task environment inputs                  |
| `mise.toml`                           | Pinned Node.js and aube versions                                      |
| `tsconfig.base.json`, `tsconfig.json` | Shared and root TypeScript configuration                              |
| `tooling/oxc`                         | Oxlint and Oxfmt configuration                                        |
| `knip.jsonc`                          | Unused-code analysis configuration                                    |
| `scripts/check-repository.mjs`        | Validates community files and Agent Skills                            |
| `scripts/tsdown.config.ts`            | Shared build configuration for tsdown packages                        |
| `.agents/skills/`                     | Agent Skills, including the Agent Zero architecture and safety skills |

## Troubleshooting

```bash
# Stale or inconsistent build artifacts
aube run clean
aube run build

# Reinstall dependencies from the lockfile
aube ci

# Stock TypeScript loaded instead of the tsgo bridge
# (tsc prints "TNB ACTIVE" on the first type-check; no banner means the install is stale)
aube ci
aube run typecheck

# Inspect the local environment
aube run zero doctor
```

## Additional resources

- [Contributing guide](CONTRIBUTING.md)
- [AI contributions policy](AI_POLICY.md)
- [Governance](GOVERNANCE.md)
- [Security policy](SECURITY.md)
- [Support channels](SUPPORT.md)
- [Issue tracker](https://github.com/wolfstar-project/agent-zero/issues)

<!-- skilld -->

Before modifying code, check .agents/skills/ for relevant skills.
Read the SKILL.md for any matching package before proceeding.
<!-- /skilld -->
