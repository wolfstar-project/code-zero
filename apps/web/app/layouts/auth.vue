<template>
  <div class="min-h-screen flex flex-col bg-canvas text-ink">
    <header class="h-16 flex items-center justify-end gap-3 px-4 md:px-6">
      <LocaleSwitcher />
      <ClientOnly>
        <ColorModeToggle />
        <template #fallback>
          <span class="h-9 w-9 border border-line bg-raised" aria-hidden="true" />
        </template>
      </ClientOnly>
    </header>
    <main class="flex flex-1 items-center justify-center px-4 pb-16">
      <slot />
    </main>
  </div>
</template>
