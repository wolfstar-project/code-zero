<template>
  <aside
    class="fixed inset-y-0 inset-is-0 z-20 hidden flex-col border-ie border-line bg-panel transition-[width] md:flex"
    :class="collapsed ? 'w-16' : 'w-52'"
  >
    <div
      class="h-16 flex items-center border-b border-line"
      :class="collapsed ? 'justify-center' : 'px-4'"
    >
      <div class="h-8 w-8 shrink-0 grid place-items-center border border-accent/45 bg-accent/8">
        <span class="font-mono text-xs text-accent font-750">AZ</span>
      </div>
      <div v-if="!collapsed" class="ms-3 min-w-0">
        <p class="m-0 truncate text-sm font-750 tracking-tight">Agent Zero</p>
        <p class="m-0 text-4xs text-muted font-650 tracking-[0.18em] uppercase">
          {{ $t('common.brand.subtitle') }}
        </p>
      </div>
    </div>

    <nav :aria-label="$t('dashboard.nav.aria')" class="flex-1 overflow-y-auto px-3 py-4">
      <component
        :is="item.to ? NuxtLink : 'button'"
        v-for="item in navItems"
        :key="item.key"
        :to="item.to"
        class="focus-ring mb-1 h-9 w-full flex items-center border-is-2 text-start text-xs font-600 transition"
        :class="[
          collapsed ? 'justify-center px-0' : 'px-3',
          isActive(item)
            ? 'border-accent bg-accent/8 text-ink'
            : 'border-transparent text-muted hover:bg-raised hover:text-ink',
          item.to ? '' : 'cursor-default',
        ]"
        :aria-current="isActive(item) ? 'page' : undefined"
        :title="collapsed ? $t(item.labelKey) : undefined"
        :aria-label="collapsed ? $t(item.labelKey) : undefined"
        :type="item.to ? undefined : 'button'"
      >
        <Icon
          :name="item.icon"
          aria-hidden="true"
          class="h-4 w-4 shrink-0"
          :class="[collapsed ? '' : 'me-2.5', isActive(item) ? 'text-accent' : '']"
        />
        <span v-if="!collapsed" class="truncate">{{ $t(item.labelKey) }}</span>
      </component>
    </nav>

    <ClientOnly>
      <!-- Only rendered where the deployment actually enables organizations; the auth server
           enforces the same policy regardless, so a stale build can only hide the switcher. -->
      <OrganizationsSwitcher v-if="!collapsed && enableOrganizations" />
      <UserMenu v-if="!collapsed" />
    </ClientOnly>

    <div class="border-t border-line" :class="collapsed ? 'px-2 py-3' : 'p-4'">
      <template v-if="!collapsed">
        <p class="m-0 label-upper">{{ $t('common.system.label') }}</p>
        <p class="m-0 mt-1.5 flex items-center gap-1.5 text-xs text-accent font-650">
          <span class="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--az-accent-glow)]" />
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
        <span class="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--az-accent-glow)]" />
      </div>
    </div>

    <div class="border-t border-line p-2">
      <button
        class="focus-ring h-9 w-full flex items-center text-xs text-muted font-600 transition hover:bg-raised hover:text-ink"
        :class="collapsed ? 'justify-center px-0' : 'px-3'"
        type="button"
        :aria-expanded="!collapsed"
        :title="collapsed ? $t('dashboard.nav.expand') : $t('dashboard.nav.collapse')"
        @click="collapsed = !collapsed"
      >
        <Icon
          :name="collapsed ? 'lucide:chevrons-right' : 'lucide:chevrons-left'"
          aria-hidden="true"
          class="h-4 w-4 shrink-0 rtl:scale-x-[-1]"
          :class="collapsed ? '' : 'me-2.5'"
        />
        <span v-if="!collapsed">{{ $t('dashboard.nav.collapse') }}</span>
        <span v-else class="sr-only">{{ $t('dashboard.nav.expand') }}</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
// Used as a value by the `<component :is>` above, not as a tag, so auto-import does not
// cover it: the nav renders a link where an item has a route and a plain button otherwise.
import { NuxtLink } from '#components';

const collapsed = useSidebarCollapsed();
const route = useRoute();

const appConfig = useAppConfig();
const enableOrganizations = appConfig.auth.enableOrganizations;

interface NavItem {
  key: string;
  labelKey: string;
  icon: string;
  /** Absent for the sections that have no page yet; those stay inert buttons. */
  to?: string;
}

/**
 * Active state is derived from the current route rather than declared per entry, so a placeholder
 * cannot claim to be the current page and a real entry cannot disagree with the address bar.
 */
const navItems: readonly NavItem[] = [
  { key: 'control', labelKey: 'dashboard.nav.control', icon: 'lucide:layout-dashboard', to: '/' },
  { key: 'tasks', labelKey: 'dashboard.nav.tasks', icon: 'lucide:list-checks' },
  { key: 'runners', labelKey: 'dashboard.nav.runners', icon: 'lucide:server' },
  { key: 'models', labelKey: 'dashboard.nav.models', icon: 'lucide:cpu' },
  { key: 'approvals', labelKey: 'dashboard.nav.approvals', icon: 'lucide:badge-check' },
  { key: 'findings', labelKey: 'dashboard.nav.findings', icon: 'lucide:shield-alert' },
  { key: 'repositories', labelKey: 'dashboard.nav.repositories', icon: 'lucide:folder-git-2' },
  { key: 'policies', labelKey: 'dashboard.nav.policies', icon: 'lucide:scale' },
  { key: 'integrations', labelKey: 'dashboard.nav.integrations', icon: 'lucide:plug' },
  { key: 'audit', labelKey: 'dashboard.nav.audit', icon: 'lucide:scroll-text', to: '/audit' },
  { key: 'settings', labelKey: 'dashboard.nav.settings', icon: 'lucide:settings' },
];

function isActive(item: NavItem): boolean {
  return item.to !== undefined && route.path === item.to;
}
</script>
