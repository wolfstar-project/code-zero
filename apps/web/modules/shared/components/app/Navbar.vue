<template>
  <!--
    One bar per page, in the place every page keeps it: the page title and the actions that act on
    the whole page. Preferences (language, theme) live in the sidebar, not here, so the bar still
    fits on a phone.
  -->
  <header
    class="sticky top-0 z-20 h-16 flex shrink-0 items-center gap-2 border-b border-line bg-canvas/92 px-4 backdrop-blur sm:gap-3 sm:px-6"
  >
    <button
      class="focus-ring -ms-2.5 h-11 w-11 grid shrink-0 place-items-center text-ink transition hover:bg-raised md:hidden"
      type="button"
      aria-controls="app-sidebar"
      :aria-expanded="open"
      :aria-label="$t('dashboard.nav.open')"
      @click="open = true"
    >
      <Icon aria-hidden="true" class="h-5 w-5" name="lucide:menu" />
    </button>

    <h1 class="m-0 min-w-0 flex-1 truncate text-base font-650 tracking-tight sm:text-lg">
      {{ title }}
    </h1>

    <div v-if="$slots.default" class="flex shrink-0 items-center gap-2 sm:gap-3">
      <slot />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{ title: string }>();

const open = useSidebarOpen();
</script>
