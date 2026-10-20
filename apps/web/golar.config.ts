import { defineConfig } from 'golar/unstable';
import '@golar/vue';

// `nuxt typecheck` picks this checker up automatically once this file exists (Nuxt 4.5+,
// https://nuxt.com/blog/v4-5#%EF%B8%8F-nuxt-cli). Golar is built on typescript-go, the same engine
// this repo already pins `typescript` to (`typescript-native-bridge` in pnpm-workspace.yaml), so it
// replaces vue-tsc rather than adding a second, differently-engined checker alongside it — and the
// same pass covers `app/`, `modules/`, `server/`, and `test/`, which previously needed a separate
// `tsc --project` invocation each.
export default defineConfig({
  typecheck: {
    include: ['**/*.ts', '**/*.vue'],
    exclude: ['**/dist/**', '**/.output/**', '**/node_modules/**'],
  },
});
