# Contributing to Code Zero

Thanks for helping build Code Zero. Bug reports, design discussions, documentation improvements, tests, and focused code changes are all welcome.

For questions and early design discussion, use the WolfStar community at [join.wolfstar.rocks](https://join.wolfstar.rocks). Read [SUPPORT.md](SUPPORT.md) to choose the right channel. Use GitHub issues for reproducible bugs and concrete proposals. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md), and project decision-making is described in [GOVERNANCE.md](GOVERNANCE.md).

## Development setup

Requirements:

- Node.js 24.2 or newer
- [aube](https://aube.jdx.dev), the pinned package manager
- Git

`mise.toml` pins both Node.js and aube, so [mise](https://mise.jdx.dev) installs the whole toolchain in one step:

```bash
git clone https://github.com/wolfstar-project/code-zero.git
cd code-zero
mise install            # or: npm install -g --ignore-scripts=false @endevco/aube
aube ci
cp .env.example .env
cp apps/dashboard/.env.example apps/dashboard/.env
aube run check:repo
aube test
```

`package.json` pins aube through `packageManager`. aube reads and writes the existing `pnpm-lock.yaml` and `pnpm-workspace.yaml` in place, so the lockfile stays in pnpm's v9 format. Do not use npm, Yarn, Bun, or another package manager in this repository, and do not add a second lockfile.

`pnpm-workspace.yaml` overrides `typescript` to [`typescript-native-bridge`](https://github.com/johnsoncodehk/typescript-native-bridge), a drop-in fork whose checker runs on tsgo in-process. `tsc` prints `TNB ACTIVE` to stderr on the first type-check in a process; no banner means stock TypeScript is loaded and the install is stale. Keep the pin exact — the fork only publishes prerelease versions, which caret ranges never match — and reinstall after changing it.

## Choose the right package

| Change                                               | Location                  |
| ---------------------------------------------------- | ------------------------- |
| Agent lifecycle and decisions                        | `packages/agent`          |
| Commands and repository mutation                     | `packages/runner`         |
| LLM providers                                        | `packages/models`         |
| Source-control provider adapters                     | `packages/source-control` |
| Configuration and policy                             | `packages/config`         |
| Shared contracts                                     | `packages/shared`         |
| CLI parsing and presentation                         | `packages/cli`            |
| Database schema and migrations                       | `packages/database`       |
| Authentication policy                                | `packages/auth`           |
| oRPC router and control-plane operations             | `packages/api`            |
| UI, HTTP host (RPC, OpenAPI, auth, dashboard routes) | `apps/dashboard`          |

Read [AGENTS.md](AGENTS.md) and the matching files in `.agents/skills/` before making architectural or safety-sensitive changes.

If an AI agent helps you write a change, read [AI_POLICY.md](AI_POLICY.md) first: you still own the diff, you still run the checks, and you disclose the agent in the pull request.

Documentation lives in `apps/docs`, a [Docus](https://docus.dev) site (`aube run dev --filter=@code-zero/docs` to preview it). The canonical architecture and provider references stay in `docs/*.md` and are included by the site — edit those files rather than duplicating their content into site pages.

## Development workflow

1. Fork the repository and branch from `main`.
2. Reproduce the issue or define observable acceptance criteria.
3. Add or update a deterministic test where behavior changes.
4. Implement the smallest change at the correct package boundary.
5. Run the relevant package checks while iterating.
6. Run the complete verification suite.
7. Open a focused pull request using the repository template.

Useful commands:

```bash
aube run dev             # watch workspace development tasks
aube run zero doctor     # inspect the local environment
aube test                # deterministic Vitest suites
aube run typecheck       # TypeScript checks across the graph
aube run lint:ci         # Oxfmt check plus type-aware Oxlint
aube run knip            # find unused files, exports, and dependencies
aube run build           # build and package validation
aube run check:repo      # community files and Agent Skills
aube run skills:list     # show Skilld-managed project skills
aube run skills:install  # restore Skilld links for Codex
```

`aube run <script>` and `aube test` check install freshness first and install
only when `node_modules` is stale, so a separate install step is rarely needed.

## Tests and safety

- Add tests beside the source as `*.test.ts`.
- Prefer stable fixtures and explicit inputs over mocks of implementation details.
- Do not call GitHub, model providers, package registries, or other live services from unit tests.
- Cover success, rejection, and recovery transitions when modifying the agent state machine.
- Cover command allowlisting, paths, timeouts, output limits, and read-only behavior when modifying the runner.
- Verify that `observe` mode cannot write before changing execution policy.

## Style and commits

Oxfmt owns formatting and Oxlint owns linting. Avoid unrelated formatting churn.

`aube install` installs Git hooks through the `prepare` script (`.husky/install.mjs`), which skips hook installation in CI and production environments:

- `pre-commit` runs `aube exec nano-staged`, which formats staged files with Oxfmt and re-stages them.
- `commit-msg` runs `aube exec commitlint --edit`, which enforces Conventional Commit messages.

If `pre-commit` fails, fix the reported error and commit again; formatting fixes are applied automatically. If `commit-msg` rejects your message, reword it to follow the Conventional Commit format below (after a failed commit, rerun `git commit` with a valid message; to fix the previous commit, use `git commit --amend`).

Use Conventional Commit-style messages and PR titles:

```text
feat(cli): add machine-readable doctor output
fix(runner): reject paths outside the checkout
docs(contributing): document release verification
test(agent): cover failed verification transition
```

## Pull request checklist

Before opening a PR, run:

```bash
aube run check:repo
aube run lint:ci
aube run typecheck
aube test
aube run build
```

In the PR, describe what changed, why it belongs at that boundary, how it was verified, and whether it changes runtime permissions or safety guarantees. Screenshots are useful only for user-visible terminal or UI changes; logs or test names are better evidence for runtime changes.
