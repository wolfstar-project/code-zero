<template>
  <div class="min-h-dvh bg-canvas text-ink">
    <AppSidebar />
    <!-- Inert while the narrow-screen drawer is open, so focus and screen readers stay in it. -->
    <main
      class="min-h-dvh flex flex-col transition-[margin]"
      :class="collapsed ? 'md:ms-16' : 'md:ms-52'"
      :inert="open"
    >
      <slot />
    </main>
    <AppShortcutsDialog />
  </div>
</template>

<script setup lang="ts">
const collapsed = useSidebarCollapsed();
const open = useSidebarOpen();

// Bound here rather than in a plugin so the shell owns them: the sign-in pages use the `auth`
// layout and should not answer to `g a`. The bindings resolve `document` lazily, so SSR is safe.
useAppShortcuts();
</script>
