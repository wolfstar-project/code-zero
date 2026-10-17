<template>
  <div class="min-h-screen bg-canvas text-ink">
    <AppSidebar />
    <main class="min-h-screen transition-[margin]" :class="collapsed ? 'md:ms-16' : 'md:ms-52'">
      <slot />
    </main>
    <AppShortcutsDialog />
  </div>
</template>

<script setup lang="ts">
const collapsed = useSidebarCollapsed();

// Bound here rather than in a plugin so the shell owns them: the sign-in pages use the `auth`
// layout and should not answer to `g a`. The bindings resolve `document` lazily, so SSR is safe.
useAppShortcuts();
</script>
