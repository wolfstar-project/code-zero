<template>
  <!-- Narrow screens only: dims the page behind the open drawer and closes it on a tap. -->
  <div
    v-if="open"
    aria-hidden="true"
    class="fixed inset-0 z-30 bg-canvas/70 backdrop-blur-sm md:hidden"
    @click="open = false"
  />

  <!--
    One sidebar for every width. From `md` up it is docked and can collapse to icons; below `md` it
    is a drawer the navbar opens, hidden (and out of the tab order) until then. Rendering it once
    rather than twice keeps a single copy of every control, so nothing on the page is duplicated
    for assistive technology or for a test looking a control up by name.
  -->
  <aside
    id="app-sidebar"
    class="fixed inset-y-0 inset-is-0 z-40 w-72 max-w-[85vw] flex flex-col border-ie border-line bg-panel duration-200 ease-out md:z-20 md:max-w-none"
    :class="[
      // Visibility flips at once when the drawer opens, so focus can move into it straight away,
      // and only after the slide when it closes, so the slide stays visible.
      // (Arbitrary properties: UnoCSS drops `transition-[a,b]` when the list has a comma.)
      open
        ? '[transition-property:translate,width]'
        : '[transition-property:translate,visibility,width] max-md:invisible max-md:-translate-x-full rtl:max-md:translate-x-full',
      compact ? 'md:w-16' : 'md:w-52',
    ]"
  >
    <div
      class="h-16 flex shrink-0 items-center gap-3 border-b border-line"
      :class="compact ? 'justify-center' : 'px-4'"
    >
      <div class="h-8 w-8 shrink-0 grid place-items-center border border-accent/45 bg-accent/8">
        <span class="font-mono text-xs text-accent font-750">AZ</span>
      </div>
      <div v-if="!compact" class="min-w-0 flex-1">
        <p class="m-0 truncate text-sm font-750 tracking-tight">Code Zero</p>
        <p class="m-0 text-4xs text-muted font-650 tracking-[0.18em] uppercase">
          {{ $t('common.brand.subtitle') }}
        </p>
      </div>
      <button
        v-if="open"
        ref="closeButton"
        class="focus-ring -me-2 h-11 w-11 grid shrink-0 place-items-center text-muted transition hover:bg-raised hover:text-ink md:hidden"
        type="button"
        :aria-label="$t('dashboard.nav.close')"
        @click="open = false"
      >
        <Icon aria-hidden="true" class="h-5 w-5" name="lucide:x" />
      </button>
    </div>

    <!-- Everything between the brand and the collapse button scrolls as one, so the account and
         preferences stay reachable on a short screen, such as a phone held in landscape. -->
    <div class="min-h-0 flex flex-1 flex-col overflow-y-auto overscroll-contain">
      <nav :aria-label="$t('dashboard.nav.aria')" class="flex-1 px-3 py-4">
        <NuxtLink
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          class="focus-ring mb-1 h-11 w-full flex items-center border-is-2 text-start text-sm font-600 transition md:h-9 md:text-xs"
          :class="[
            compact ? 'justify-center px-0' : 'px-3',
            isActive(item)
              ? 'border-accent bg-accent/8 text-ink'
              : 'border-transparent text-muted hover:bg-raised hover:text-ink',
          ]"
          :aria-current="isActive(item) ? 'page' : undefined"
          :title="compact ? $t(item.labelKey) : undefined"
          :aria-label="compact ? $t(item.labelKey) : undefined"
          @click="open = false"
        >
          <Icon
            :name="item.icon"
            aria-hidden="true"
            class="h-4 w-4 shrink-0"
            :class="[compact ? '' : 'me-2.5', isActive(item) ? 'text-accent' : '']"
          />
          <span v-if="!compact" class="truncate">{{ $t(item.labelKey) }}</span>
        </NuxtLink>
      </nav>

      <ClientOnly>
        <!-- Only rendered where the deployment actually enables organizations, as `/api/capabilities`
           reports at runtime; the auth server enforces the same policy regardless. -->
        <OrganizationsSwitcher v-if="!compact && enableOrganizations" />
        <UserMenu v-if="!compact" />
      </ClientOnly>

      <!-- Preferences belong to the person, not to a page, so they sit with the account rather than
         being repeated in every page header. -->
      <div
        class="flex items-center gap-2 border-t border-line"
        :class="compact ? 'justify-center px-2 py-3' : 'p-3'"
      >
        <LocaleSwitcher v-if="!compact" class="min-w-0 flex-1 max-md:h-11" />
        <ClientOnly>
          <ColorModeToggle class="shrink-0 max-md:h-11 max-md:w-11" />
          <template #fallback>
            <span
              class="h-9 w-9 shrink-0 border border-line bg-raised max-md:h-11 max-md:w-11"
              aria-hidden="true"
            />
          </template>
        </ClientOnly>
      </div>

      <div class="border-t border-line" :class="compact ? 'px-2 py-3' : 'p-4'">
        <template v-if="!compact">
          <p class="m-0 label-upper">{{ $t('common.system.label') }}</p>
          <p class="m-0 mt-1.5 flex items-center gap-1.5 text-xs text-accent font-650">
            <span
              class="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--cz-accent-glow)]"
            />
            {{ $t('common.system.healthy') }}
          </p>
          <p class="m-0 mt-3 label-upper">{{ $t('common.build.label') }}</p>
          <!-- Sits directly under the signed-in user, where an operator reading a bug report looks
             for what the deployment in front of them actually is. -->
          <BuildEnvironment />
        </template>
        <div
          v-else
          class="grid place-items-center py-1"
          :title="$t('common.system.healthy')"
          role="img"
          :aria-label="`${$t('common.system.label')}: ${$t('common.system.healthy')}`"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--cz-accent-glow)]" />
        </div>
      </div>
    </div>

    <!-- Collapsing only means something while the sidebar is docked. -->
    <div class="border-t border-line p-2 max-md:hidden">
      <button
        class="focus-ring h-9 w-full flex items-center text-xs text-muted font-600 transition hover:bg-raised hover:text-ink"
        :class="compact ? 'justify-center px-0' : 'px-3'"
        type="button"
        :aria-expanded="!collapsed"
        :title="collapsed ? $t('dashboard.nav.expand') : $t('dashboard.nav.collapse')"
        @click="collapsed = !collapsed"
      >
        <Icon
          :name="collapsed ? 'lucide:chevrons-right' : 'lucide:chevrons-left'"
          aria-hidden="true"
          class="h-4 w-4 shrink-0 rtl:scale-x-[-1]"
          :class="compact ? '' : 'me-2.5'"
        />
        <span v-if="!compact">{{ $t('dashboard.nav.collapse') }}</span>
        <span v-else class="sr-only">{{ $t('dashboard.nav.expand') }}</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useHotkey } from '@tanstack/vue-hotkeys';

const collapsed = useSidebarCollapsed();
const open = useSidebarOpen();
const route = useRoute();

// Bound to the document rather than to the drawer, so Escape still closes it after a tap on
// something inside that cannot hold focus. `ignoreInputs: false` for the language picker.
useHotkey(
  'Escape',
  () => {
    open.value = false;
  },
  { enabled: open, ignoreInputs: false },
);

/**
 * Whether the sidebar shows icons only. Collapsing is a desktop preference; the drawer a narrow
 * screen opens always shows the labels, whatever that preference says.
 */
const compact = computed(() => collapsed.value && !open.value);

const capabilities = await useAuthCapabilities();
const enableOrganizations = computed(() => capabilities.value.organizations);

interface NavItem {
  key: string;
  labelKey: string;
  icon: string;
  to: string;
}

/**
 * Every entry is a page that exists. The nav used to carry nine more as inert buttons, which
 * promised surfaces the app does not have — an operator clicking Runners learned only that the
 * click did nothing. A section earns an entry when it has somewhere to go.
 *
 * Active state is derived from the current route rather than declared per entry, so an entry
 * cannot disagree with the address bar.
 */
const navItems: readonly NavItem[] = [
  { key: 'control', labelKey: 'dashboard.nav.control', icon: 'lucide:layout-dashboard', to: '/' },
  { key: 'audit', labelKey: 'dashboard.nav.audit', icon: 'lucide:scroll-text', to: '/audit' },
  // Listed for every signed-in account: what the page shows depends on the edition and the role,
  // and it explains a refusal itself rather than the nav guessing who may open it.
  { key: 'settings', labelKey: 'dashboard.nav.settings', icon: 'lucide:settings', to: '/settings' },
];

function isActive(item: NavItem): boolean {
  return route.path === item.to;
}

const closeButton = useTemplateRef<HTMLButtonElement>('closeButton');

/** Where focus was when the drawer opened, so closing it puts the reader back where they were. */
let returnFocusTo: HTMLElement | undefined;

watch(open, async (isOpen) => {
  if (isOpen) {
    returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    await nextTick();
    closeButton.value?.focus();
    return;
  }
  // After the render that lifts `inert` from the page, or the button cannot take focus. The navbar
  // that opened the drawer is gone when it closed by navigating; focus then stays with the new
  // page instead of jumping to a detached button.
  const target = returnFocusTo;
  returnFocusTo = undefined;
  await nextTick();
  if (target?.isConnected) target.focus();
});

// Back and forward navigate without a click on the nav, and should still leave the page visible.
watch(
  () => route.fullPath,
  () => {
    open.value = false;
  },
);

/**
 * Closes the drawer when the window grows past `md`: the sidebar docks there, and the layout
 * would otherwise keep the page inert behind a drawer that no longer exists.
 */
let desktop: MediaQueryList | undefined;

function closeOnDesktop(event: MediaQueryListEvent): void {
  if (event.matches) open.value = false;
}

onMounted(() => {
  desktop = window.matchMedia('(min-width: 48rem)');
  desktop.addEventListener('change', closeOnDesktop);
});

onBeforeUnmount(() => {
  desktop?.removeEventListener('change', closeOnDesktop);
});
</script>
