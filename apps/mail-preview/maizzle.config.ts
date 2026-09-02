import { fileURLToPath } from 'node:url';

import { defineConfig } from '@maizzle/framework';

/**
 * Preview settings for the templates owned by `@code-zero/mail`.
 *
 * `emails/` here is a symlink into that package, so the dev server watches and hot-reloads the
 * real template files while keeping clean `emails/<Template>` preview routes — the Maizzle dev
 * UI cannot address templates outside the working directory (its endpoints break on `../`
 * segments, which browsers normalize away).
 */
export default defineConfig({
  // Layouts live one level deeper and are imported by templates, not templates themselves.
  content: ['emails/*.vue'],
  output: {
    path: fileURLToPath(new URL('dist', import.meta.url)),
  },
  css: {
    inline: true,
    purge: true,
  },
  // Sample data read by templates through `useConfig()`. Keys mirror MailTemplateContext in
  // packages/mail; `name` serves emailVerification and passwordReset alike.
  name: 'Ada Lovelace',
  verifyUrl: 'https://example.com/verify?token=sample',
  resetUrl: 'https://example.com/reset?token=sample',
  organizationName: 'Acme Inc.',
  inviterName: 'Grace Hopper',
  acceptUrl: 'https://example.com/invite?token=sample',
  shareUrl: 'https://example.com/invite?token=public-sample',
  maxUses: '25',
  expiresAt: '2026-09-01T00:00:00.000Z',
});
