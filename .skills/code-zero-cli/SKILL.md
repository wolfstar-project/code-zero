---
name: code-zero-cli
description: Use when adding or changing Code Zero CLI commands, flags, prompts, output, exit codes, or version display.
---

# Code Zero CLI

The CLI uses `@bomb.sh/args` for typed parsing and `@clack/prompts` for human-friendly interaction.

## Rules

- Keep parsing pure and testable in `packages/cli/src/args.ts`.
- Keep prompts and terminal effects in the entry point or a presentation adapter.
- Every interactive input must have a non-interactive flag equivalent.
- Never prompt when stdin is not a TTY; fail with a clear message or use a documented safe default.
- `--json` output must contain machine-readable data only on stdout. Diagnostics go to stderr.
- Use stable exit codes and avoid parsing human-formatted output in scripts.
- Obtain the displayed version through the injected shared version marker.
- CLI commands request runtime behavior through typed APIs; they do not execute repository commands directly.
- A session obtained by `zero login` is stored per deployment origin in
  `$XDG_CONFIG_HOME/code-zero/credentials.json`, owner-readable only (`packages/cli/src/credentials.ts`).
  Never write a token beside the checkout, never log one, and never key the store by anything but
  the normalized origin — one workstation is expected to hold a cloud-managed and a self-hosted
  session at once.
- The device flow (`packages/cli/src/login.ts`) speaks plain `fetch` against the deployment's
  `/api/auth/device/**`, not Better Auth's client: the CLI is a terminal adapter and must not pull
  a server-side authentication library. `fetch` is injectable so the specs never open a socket.

## Adding a command

1. Define arguments, defaults, and validation with `@bomb.sh/args`.
2. Add parser tests for success, missing values, conflicts, and unknown flags.
3. Add Clack presentation only after parsing succeeds.
4. Document the command in `README.md` and `CONTRIBUTING.md` when contributor-facing.
5. Verify interactive and non-interactive behavior.
6. Run `aube run test --filter @code-zero/cli` and the root checks.
