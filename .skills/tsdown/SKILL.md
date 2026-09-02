---
name: tsdown
description: Build or change Code Zero packages and apps with the repository's shared tsdown configuration, package validation, and version injection.
---

# tsdown in Code Zero

Use this skill when changing build entries, output formats, declarations, package exports, executable output, or version injection.

## Repository rules

- The base configuration is `scripts/tsdown.config.ts`.
- Every workspace built with tsdown keeps a small `tsdown.config.ts` that imports the shared factory. The Nuxt dashboard uses the Nuxt build pipeline and does not keep a tsdown config.
- Publishable packages output ESM and CommonJS with declarations and source maps.
- Apps and the CLI output ESM executables without publishable-library declarations unless explicitly needed.
- Publishable package builds must keep `publint` and `attw` validation enabled.
- Build-time Node.js is 22.18 or newer; generated bundles target Node.js 20.11 unless a package documents a stricter runtime.
- `@redstardev/unplugin-version-injector` owns the version marker. Do not hardcode a second CLI version source.
- Never edit `dist/` manually.

## Workflow

1. Read `scripts/tsdown.config.ts`, the package config, and its `package.json` exports.
2. Decide whether the target is a publishable library, CLI, or app.
3. Change the shared factory only when the behavior should apply to multiple workspaces.
4. Keep package-local overrides narrow and explicit.
5. Run `aube run build --filter <package>` while iterating.
6. Run `aube run build` before handoff and inspect publint/attw output.
7. For version changes, run the injected-version smoke test used in `.github/workflows/ci.yaml`.

## Common failures

- If packing uses an invalid Windows temp path under WSL, export `TMPDIR=/tmp` in the shell before running the build; the root scripts no longer set it.
- If declarations expose private or adapter-specific types, move the contract to the correct package instead of suppressing declaration errors.
- If ESM/CJS validation fails, align `exports`, extensions, and declarations rather than disabling validation.
