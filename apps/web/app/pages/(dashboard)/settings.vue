<template>
  <header
    class="h-16 flex items-center justify-between border-b border-line bg-canvas/92 px-4 backdrop-blur md:px-6"
  >
    <div>
      <p class="m-0 text-3xs text-muted font-700 tracking-[0.18em] uppercase">
        {{ $t('dashboard.settings.header.eyebrow') }}
      </p>
      <h1 class="m-0 mt-1 text-lg font-650 tracking-tight">
        {{ $t('dashboard.settings.header.title') }}
      </h1>
    </div>

    <div class="flex items-center gap-3">
      <LocaleSwitcher />
      <ClientOnly>
        <ColorModeToggle />
        <template #fallback>
          <span class="h-9 w-9 border border-line bg-raised" aria-hidden="true" />
        </template>
      </ClientOnly>
      <button
        class="btn-subtle gap-2 px-3"
        type="button"
        :disabled="pending"
        :aria-label="$t('common.actions.refresh')"
        @click="refresh"
      >
        <Icon aria-hidden="true" class="h-3.5 w-3.5" name="lucide:refresh-cw" />
        <span class="hidden sm:inline">{{ $t('common.actions.refresh') }}</span>
      </button>
    </div>
  </header>

  <div class="p-3 sm:p-4 md:p-5">
    <SettingsState
      v-if="!view && (pending || !error)"
      kind="loading"
      :message="$t('dashboard.settings.loading')"
    />
    <SettingsState
      v-else-if="!view && error"
      :kind="error === 'forbidden' ? 'forbidden' : 'error'"
      :title="$t('dashboard.settings.error.title')"
      :message="$t(readErrorKey)"
      :retry="error !== 'forbidden' && error !== 'unavailable'"
      @retry="refresh"
    />

    <!-- Self-hosted: the whole document, read-only from the file or editable from the store. -->
    <div
      v-else-if="view?.edition === 'self-hosted'"
      class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div class="grid min-w-0 gap-4">
        <SettingsProblems
          v-if="!view.state.ok"
          tone="danger"
          :issues="view.state.issues"
          :title="$t('dashboard.settings.invalid.title')"
          :body="$t('dashboard.settings.invalid.body')"
        />
        <SettingsProblems
          v-else
          tone="warning"
          :issues="view.state.warnings"
          :title="$t('dashboard.settings.warnings.title')"
        />

        <SettingsForm v-if="view.editable" :view="view" :save="save" @saved="replace" />
        <SettingsSummary v-else-if="view.state.ok" :settings="view.state.settings" />
      </div>

      <aside class="grid min-w-0 gap-4">
        <SettingsSource :view="view" />
        <SettingsServices :services="view.services" />
        <SettingsExport :available="view.state.ok" :exporter="exporter" />
      </aside>
    </div>

    <!-- Managed cloud: the service is fixed; the plan and the organization's own limits are not. -->
    <div
      v-else-if="view?.edition === 'cloud'"
      class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div class="grid min-w-0 gap-4">
        <section class="panel" :aria-labelledby="planTitleId">
          <h2 :id="planTitleId" class="section-title m-0 text-xs">
            {{ $t('dashboard.settings.plan.title') }}
          </h2>
          <div class="p-4">
            <SettingsExecution v-if="view.plan" :execution="view.plan" />
            <p v-else class="m-0 text-xs text-warning">
              {{ $t('dashboard.settings.plan.unavailable') }}
            </p>
            <p class="m-0 mt-3 text-3xs text-muted">{{ $t('dashboard.settings.plan.caption') }}</p>
          </div>
        </section>

        <!-- Keyed by organization: switching starts a fresh form, so nothing typed or reported
             for one organization is shown against another. -->
        <SettingsOrganizationLimits
          v-if="view.organization"
          :key="view.organization.id"
          :organization="view.organization"
          :plan="view.plan"
          :bounds="view.bounds"
          :save="saveOrganization"
          @saved="replaceOrganization"
        />
        <SettingsState
          v-else
          kind="forbidden"
          :title="$t('dashboard.settings.organization.title')"
          :message="$t('dashboard.settings.organization.none')"
        />
      </div>

      <aside class="grid min-w-0 gap-4">
        <SettingsSource :view="view" />
        <SettingsServices :services="view.services" />
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OrganizationSettingsView } from '@code-zero/api';
import { useHotkeys } from '@tanstack/vue-hotkeys';

import { useShortcutsDialog } from '../../../modules/shared/composables/useAppShortcuts';

// The typed client lives on the Nuxt app; the composables take the one call they need rather than
// the app instance, so they stay drivable from a plain unit test.
const { $orpc } = useNuxtApp();
const { view, pending, error, refresh, replace } = useSettings(() => $orpc.settings.get());
const dialogOpen = useShortcutsDialog();
const planTitleId = useId();

const save = (input: Parameters<typeof $orpc.settings.update>[0]) => $orpc.settings.update(input);
const exporter = () => $orpc.settings.export();
const saveOrganization = (request: Parameters<typeof $orpc.settings.organization.update>[0]) =>
  $orpc.settings.organization.update(request);

/**
 * The organization's save answers with its own view; the rest of the page stays as it was.
 *
 * A save can outlive the selection it was made for: start saving one organization, switch to
 * another, and the answer arrives after the page already shows the second. Installing it then
 * would put the first organization's limits — and its id, which the next save uses — back on
 * screen under the second's name, so an answer for an organization no longer shown is dropped.
 */
function replaceOrganization(organization: OrganizationSettingsView): void {
  if (view.value?.edition !== 'cloud' || view.value.organization?.id !== organization.id) return;
  replace({ ...view.value, organization });
}

// Client-side only, like the audit log: the procedure authenticates the browser's session, and
// what it returns depends on who is asking.
onMounted(refresh);

// On the managed cloud the organization limits shown are the active organization's, which the
// sidebar's switcher can change at any time — including right after mount, when it selects the
// first organization for a session that had none. Read again whenever it does, so the page never
// shows (or saves against) an organization the session has moved away from.
const { activeOrganization } = useOrganizations();
watch(
  () => activeOrganization.value?.id,
  (next, previous) => {
    if (next !== previous && view.value?.edition === 'cloud') void refresh();
  },
);

// Spelled out rather than interpolated, so `i18n:report` can verify every key exists.
const READ_ERROR_KEYS = {
  forbidden: 'dashboard.settings.error.forbidden',
  unauthorized: 'dashboard.settings.error.unauthorized',
  unavailable: 'dashboard.settings.error.unavailable',
  invalid: 'dashboard.settings.error.generic',
  precondition: 'dashboard.settings.error.generic',
  generic: 'dashboard.settings.error.generic',
} as const;

const readErrorKey = computed(() => READ_ERROR_KEYS[error.value ?? 'generic']);

useHotkeys([
  {
    hotkey: 'R',
    callback: () => void refresh(),
    options: { enabled: () => !pending.value && !dialogOpen.value },
  },
]);
</script>
