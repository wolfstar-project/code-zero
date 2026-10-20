<template>
  <div class="auth-shell bg-canvas text-ink">
    <div class="auth-entry">
      <header class="auth-toolbar flex items-center justify-end gap-3 px-5 sm:px-8">
        <LocaleSwitcher />
        <ClientOnly>
          <ColorModeToggle />
          <template #fallback>
            <span class="h-11 w-11" aria-hidden="true" />
          </template>
        </ClientOnly>
      </header>
      <main class="auth-main">
        <div class="auth-form">
          <NuxtLink
            class="auth-brand focus-ring mb-10 inline-flex items-center gap-3 text-ink"
            to="/"
          >
            <span class="auth-mark bg-accent" aria-hidden="true" />
            <span class="text-base font-650 tracking-tight">Code Zero</span>
          </NuxtLink>
          <slot />
        </div>
      </main>
    </div>
    <aside class="auth-story" :aria-label="$t('auth.brand.label')">
      <div class="auth-story-copy">
        <h2 class="m-0 font-600 tracking-tight">{{ $t('auth.brand.title') }}</h2>
        <p class="mb-0 mt-6 text-base leading-relaxed">{{ $t('auth.brand.description') }}</p>
      </div>
      <span class="auth-version mono">v{{ buildInfo.version }}</span>
    </aside>
  </div>
</template>

<script setup lang="ts">
const buildInfo = useBuildInfo();

useHead({ htmlAttrs: { 'data-layout': 'auth' } });
</script>

<style scoped>
.auth-shell {
  min-height: 100svh;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.auth-entry {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.auth-toolbar {
  min-height: 5rem;
}

.auth-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.5rem 5rem;
}

.auth-form {
  width: 100%;
  max-width: 24rem;
}

.auth-brand {
  min-height: 2.75rem;
  text-decoration: none;
}

.auth-mark {
  width: 1.75rem;
  height: 1.75rem;
  mask: url('/logo-mark.svg') center / contain no-repeat;
}

.auth-form :deep(h1) {
  font-size: clamp(1.5rem, 2vw, 1.875rem);
  line-height: 1.25;
}

.auth-form :deep(input),
.auth-form :deep(button),
.auth-form :deep(.btn-subtle),
.auth-toolbar :deep(button),
.auth-toolbar :deep(select) {
  min-height: 2.75rem;
  font-size: 1rem;
}

.auth-toolbar :deep(button) {
  min-width: 2.75rem;
}

.auth-form :deep(label > span) {
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: normal;
  text-transform: none;
}

.auth-form :deep(p),
.auth-form :deep(.btn-link) {
  font-size: 0.875rem;
}

.auth-form :deep(.btn-link) {
  min-height: 2.75rem;
  align-content: center;
}

.auth-story {
  position: relative;
  display: none;
  min-width: 0;
  padding: 4rem;
  background-color: color-mix(in oklch, var(--cz-accent) 32%, var(--cz-panel));
  /* The reference's checkerboard is a static brand texture, with no image or script cost. */
  background-image: repeating-conic-gradient(
    color-mix(in oklch, var(--cz-accent) 10%, transparent) 0% 25%,
    transparent 0% 50%
  );
  background-size: 4rem 4rem;
}

.auth-story-copy {
  max-width: 32rem;
}

.auth-story h2 {
  font-size: clamp(2.25rem, 3.5vw, 3.75rem);
  line-height: 1.1;
  text-wrap: balance;
}

.auth-story p {
  max-width: 29rem;
  color: var(--cz-ink);
}

.auth-version {
  position: absolute;
  inset-block-end: 2.5rem;
  inset-inline-start: 4rem;
  color: var(--cz-ink);
}

@media (min-width: 64rem) {
  .auth-shell {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .auth-story {
    display: flex;
    align-items: center;
  }
}
</style>

<style>
/*
 * The narrative panel runs to the viewport edge. The gutter `tokens.css` reserves for a scrollbar
 * would leave a canvas-coloured strip beside it wherever scrollbars are not overlaid, and the
 * split layout fits the viewport, so it gives the gutter back.
 */
@media (min-width: 64rem) {
  html[data-layout='auth'] {
    scrollbar-gutter: auto;
  }
}
</style>
