<template>
  <header class="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur">
    <div class="shell h-16 flex items-center gap-2 sm:gap-4">
      <NuxtLink
        class="focus-ring min-h-11 flex shrink-0 items-center gap-2.5"
        :to="localePath({ path: '/' })"
        :aria-label="site.name"
      >
        <SiteAppLogo class="h-8 w-8 shrink-0" />
        <span class="text-sm font-750 tracking-tight">{{ site.name }}</span>
      </NuxtLink>

      <nav :aria-label="$t('marketing.nav.aria')" class="ms-4 hidden items-center gap-1 lg:flex">
        <NuxtLink
          v-for="link in navigation"
          :key="link.id"
          class="focus-ring min-h-11 inline-flex items-center px-2.5 text-sm text-muted font-600 transition hover:text-ink"
          :to="link.to"
          :external="link.external"
          :target="link.external ? '_blank' : undefined"
          :rel="link.external ? 'noreferrer' : undefined"
        >
          {{ $t(`marketing.nav.${link.id}`) }}
        </NuxtLink>
      </nav>

      <div class="ms-auto flex items-center gap-1 sm:gap-2">
        <ClientOnly>
          <ColorModeToggle />
          <template #fallback>
            <span class="h-11 w-11" aria-hidden="true" />
          </template>
        </ClientOnly>
        <LocaleSwitcher class="hidden sm:block" />
        <a class="btn btn-accent px-3 sm:px-5" :href="dashboardUrl">
          {{ $t('marketing.nav.signIn') }}
        </a>
        <button
          class="btn-icon lg:hidden"
          type="button"
          :aria-expanded="menuOpen"
          aria-controls="site-mobile-menu"
          :aria-label="menuOpen ? $t('marketing.nav.closeMenu') : $t('marketing.nav.openMenu')"
          @click="menuOpen = !menuOpen"
        >
          <Icon aria-hidden="true" class="h-4 w-4" :name="menuOpen ? 'lucide:x' : 'lucide:menu'" />
        </button>
      </div>
    </div>

    <nav
      v-show="menuOpen"
      id="site-mobile-menu"
      :aria-label="$t('marketing.nav.aria')"
      class="border-t border-line bg-panel lg:hidden"
    >
      <ul class="shell m-0 list-none flex flex-col gap-1 py-4">
        <li v-for="link in navigation" :key="link.id">
          <NuxtLink
            class="focus-ring min-h-11 flex items-center px-2 text-base text-muted font-600 transition hover:text-ink"
            :to="link.to"
            :external="link.external"
            :target="link.external ? '_blank' : undefined"
            :rel="link.external ? 'noreferrer' : undefined"
            @click="menuOpen = false"
          >
            {{ $t(`marketing.nav.${link.id}`) }}
          </NuxtLink>
        </li>
        <li class="pt-1 sm:hidden">
          <LocaleSwitcher />
        </li>
      </ul>
    </nav>
  </header>
</template>

<script setup lang="ts">
const localePath = useLocalePath();
// `siteNavigation` keeps a plain `(path: string) => string` signature so it stays checkable by the
// package's plain `tsc` pass and testable outside Nuxt; this adapts the real `localePath` (which
// vue-router 5's typed routes now require as `{ path }`, not a bare string) to that shape.
const navigation = computed(() => siteNavigation((path) => localePath({ path }), links.docs));
const dashboardUrl = useRuntimeConfig().public.dashboardUrl;

const menuOpen = ref(false);

// Leaving the menu open across a route change would cover the page the visitor just asked for.
const route = useRoute();
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
  },
);
</script>
