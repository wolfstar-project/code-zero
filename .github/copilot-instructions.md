# Code Zero repository instructions

Read `/AGENTS.md` before editing and load the relevant skill from `/.agents/skills/`.

- Use aube and the root scripts. It keeps `pnpm-lock.yaml` and `pnpm-workspace.yaml` in place.
- Preserve the package dependency direction documented in `/docs/architecture.md`.
- Keep runtime command execution and target-repository mutation inside `packages/runner`.
- Keep `observe` mode read-only.
- Add deterministic tests for behavior, state transitions, and safety-sensitive changes.
- Keep `apps/dashboard` frontend-only, use `@bomb.sh/args` plus `@clack/prompts` in the CLI, tsdown for package builds, and Oxlint/Oxfmt for code quality.
- Do not introduce Hono, ESLint, Prettier, npm, Yarn, or Bun without an accepted architectural proposal.
- Run `aube run check:repo`, `aube run lint:ci`, `aube run typecheck`, `aube test`, and `aube run build` before handing off a complete change.
