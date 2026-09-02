<template>
  <div class="min-h-screen flex flex-col text-ink">
    <a class="skip-link focus-ring" :href="`#${mainContentId}`">
      {{ $t('common.skipToContent') }}
    </a>
    <SiteHeader />
    <main :id="mainContentId" class="flex-1">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>
<style scoped>
/* Visually hidden until focused: a keyboard user should be able to jump the whole navigation, but
   the link must not push the header down for everyone else. */
.skip-link {
  position: absolute;
  z-index: 50;
  inset-block-start: 0.5rem;
  inset-inline-start: 0.5rem;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--cz-line);
  background: var(--cz-raised);
  color: var(--cz-ink);
  font-size: 0.8125rem;
  font-weight: 650;
  transform: translateY(-200%);
}

.skip-link:focus-visible {
  transform: translateY(0);
}
</style>
