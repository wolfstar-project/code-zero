export default defineAppConfig({
  // Docus 5 reads `header`, `seo` and `github` at the top level. Without them it falls back to the
  // package name (`@code-zero/docs`) and builds edit links without the `apps/docs` root.
  header: {
    title: 'Code Zero',
  },
  seo: {
    title: 'Code Zero',
    titleTemplate: '%s - Code Zero',
    description:
      'An open-source autonomous engineer that finds, fixes, and verifies problems in pull requests.',
  },
  github: {
    url: 'https://github.com/wolfstar-project/code-zero',
    branch: 'main',
    rootDir: 'apps/docs',
  },
  ui: {
    colors: {
      primary: 'green',
      neutral: 'neutral',
    },
    header: {
      slots: {
        // The text wordmark rendered in place of a logo.
        left: 'font-semibold text-highlighted',
      },
    },
    pageHero: {
      slots: {
        // A documentation home, not a landing page: keep the task paths in the first viewport.
        container: 'py-16 sm:py-20 lg:py-24 gap-12 sm:gap-y-16',
        title: 'text-4xl sm:text-5xl lg:text-6xl',
      },
    },
    pageCard: {
      slots: {
        description: 'text-base leading-relaxed',
      },
    },
    contentNavigation: {
      slots: {
        link: 'min-h-11 lg:min-h-0',
      },
    },
    contentSurround: {
      slots: {
        // Square corners: `--ui-radius: 0` does not reach `rounded-full`.
        linkLeading: 'rounded-none',
      },
    },
    prose: {
      p: { base: 'leading-8 break-words' },
      li: { base: 'leading-8 break-words' },
      pre: {
        slots: {
          // Keep commands and ASCII diagrams on one line and scroll them instead of wrapping.
          base: 'whitespace-pre',
        },
      },
    },
  },
});
