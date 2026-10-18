import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineNuxtConfig } from 'nuxt/config';

const contentDirectory = join(dirname(fileURLToPath(import.meta.url)), 'content');

// VitePress-style `<!--@include: path[#region]-->` directives, so the canonical
// architecture and provider references stay in the repository-root docs/
// directory and agents and the site read the same source. Regions are the
// `<!-- #region name -->` / `<!-- #endregion name -->` pairs in the target
// file; a missing file or region fails the build so drift cannot ship.
const includeDirective = /<!--\s*@include:\s*(\S+?)(?:#([\w-]+))?\s*-->/g;

function resolveIncludes(body: string, directory: string): string {
  return body.replace(includeDirective, (_, target: string, region?: string) => {
    const absolute = resolve(directory, target);
    let text = readFileSync(absolute, 'utf8');
    if (region) {
      const marked = new RegExp(
        `<!--\\s*#region ${region}\\s*-->\\r?\\n([\\s\\S]*?)<!--\\s*#endregion ${region}\\s*-->`,
      ).exec(text);
      if (!marked?.[1]) {
        throw new Error(`@include region "${region}" not found in ${absolute}`);
      }
      text = marked[1];
    }
    // Included sources may open with a comment and the document H1; the page
    // frontmatter already provides the title, so drop it to avoid a duplicate.
    text = text.replace(/^\s*(?:<!--[\s\S]*?-->\s*)?# .+\r?\n/, '');
    return resolveIncludes(text, dirname(absolute));
  });
}

export default defineNuxtConfig({
  extends: ['docus'],

  compatibilityDate: '2026-08-09',

  site: { name: 'Code Zero' },

  devServer: {
    // 3000 is the dashboard, 3001 marketing, 3005 mail-preview.
    port: 3002,
  },

  app: {
    head: {
      link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    },
  },

  // Dark-first, like the dashboard and marketing apps.
  colorMode: {
    preference: 'system',
    fallback: 'dark',
  },

  content: {
    experimental: {
      // Node's built-in `node:sqlite` (Node 22.5+; this repo requires 24.2+) rather than the
      // `better-sqlite3` connector, which needs a native build step this repo's dependency
      // policy does not allow-list and CI does not run interactively to approve.
      nativeSqlite: true,
      sqliteConnector: 'native',
    },
  },

  hooks: {
    'content:file:beforeParse'(ctx) {
      if (!ctx.file.id.endsWith('.md')) return;
      // Content ids are `<collection>/<path relative to the content source>`.
      const relative = ctx.file.id.split('/').slice(1).join('/');
      try {
        ctx.file.body = resolveIncludes(ctx.file.body, dirname(join(contentDirectory, relative)));
      } catch (error) {
        // @nuxt/content downgrades a parse failure to a warning and drops the
        // page, which would let include drift ship silently. Keep dev alive so
        // the file can be fixed under watch, but fail a production build hard.
        if (process.env.NODE_ENV !== 'development') {
          console.error(`[docs] ${ctx.file.id}: ${error instanceof Error ? error.message : error}`);
          process.exit(1);
        }
        throw error;
      }
    },
  },
});
