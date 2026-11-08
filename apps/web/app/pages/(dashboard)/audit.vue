<template>
  <AppNavbar :title="$t('dashboard.audit.header.title')">
    <button
      class="btn-subtle gap-2 px-3 max-sm:h-11 max-sm:w-11 max-sm:px-0"
      type="button"
      :disabled="pending"
      @click="refresh"
    >
      <Icon aria-hidden="true" class="h-3.5 w-3.5 max-sm:h-4 max-sm:w-4" name="lucide:refresh-cw" />
      <span class="max-sm:sr-only">{{ $t('common.actions.refresh') }}</span>
    </button>
  </AppNavbar>

  <div class="p-4 sm:p-6">
    <AuditTable ref="auditTable" :rows="rows" :pending="pending" :error="error" @retry="refresh" />

    <!-- Reported beside the list, never in place of it: the control plane's own records are this
         deployment's and stay readable whatever the hosted trail answers. -->
    <p v-if="authNoticeKey" class="mt-3 flex items-center justify-center gap-2 text-3xs text-muted">
      <Icon aria-hidden="true" class="h-3.5 w-3.5" name="lucide:info" />
      {{ $t(authNoticeKey) }}
    </p>

    <div v-if="hasMore" class="mt-4 flex flex-col items-center gap-2">
      <!-- The rows this failed page would have extended are still on screen (see AuditTable);
           this only says the extension stalled. The button below already retries the same
           cursor, since `loadMore` — not `refresh` — is what set this error. -->
      <p v-if="loadMoreErrorKey" class="m-0 text-3xs text-danger">{{ $t(loadMoreErrorKey) }}</p>
      <button class="btn-subtle gap-2 px-3" type="button" :disabled="pending" @click="loadMore">
        <Icon aria-hidden="true" class="h-3.5 w-3.5" name="lucide:chevron-down" />
        {{ $t('dashboard.audit.table.loadMore') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useHotkeys } from '@tanstack/vue-hotkeys';

import { useShortcutsDialog } from '../../../modules/shared/composables/useAppShortcuts';

// The typed client lives on the Nuxt app; the composables take the one call they need rather than
// the app instance, so they stay drivable from a plain unit test.
const { $orpc } = useNuxtApp();
const { rows, pending, error, authError, authEnabled, hasMore, refresh, loadMore } = useAuditTrail(
  (query) => $orpc.audit.list(query),
);
const dialogOpen = useShortcutsDialog();

// Client-side only: both trails authenticate the browser's session, and this page is not
// first-paint content. See `useAuditLogs` for the full reasoning.
onMounted(refresh);

// Spelled out rather than interpolated, so `i18n:report` can verify both keys exist.
const AUTH_NOTICE_KEYS: Readonly<Record<string, string>> = {
  forbidden: 'dashboard.audit.authNotice.forbidden',
  unauthorized: 'dashboard.audit.authNotice.generic',
  generic: 'dashboard.audit.authNotice.generic',
};

// Reuses the same copy `AuditTable` shows for a fetch that leaves nothing to display; here it
// only ever runs beside rows that are already on screen, so it reads as a stall, not a wipeout.
const ERROR_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  forbidden: 'dashboard.audit.error.forbidden',
  unauthorized: 'dashboard.audit.error.unauthorized',
  generic: 'dashboard.audit.error.generic',
};

/**
 * `error` can only be set alongside rows the reader already has when a `loadMore` — not a
 * `refresh` — is what failed; see `useAuditLogs` for why a cursorless failure clears `rows`
 * itself. That is exactly the case the button below already retries, so this only needs to
 * explain the stall, never to route the click anywhere else.
 */
const loadMoreErrorKey = computed(() =>
  error.value && rows.value.length > 0 ? ERROR_MESSAGE_KEYS[error.value] : undefined,
);

/**
 * Only worth saying where the deployment configured the hosted trail at all: on one that never
 * did, "authentication events are unavailable" would describe a feature nobody enabled.
 */
const authNoticeKey = computed(() =>
  authEnabled && authError.value ? AUTH_NOTICE_KEYS[authError.value] : undefined,
);

// Typed structurally rather than with `InstanceType`: the component is globally registered by the
// audit module, so there is no import here to take a type from.
const auditTable = useTemplateRef<{ focusFilter: () => void }>('auditTable');

// The sheet under `?` lists these; keep the two in step when either changes. All three are
// gated on the shortcuts sheet being closed: it is a modal overlay, and without the guard `r`
// and `m` would still act on this page — and `/` would still steal focus into the filter field —
// while the reader is looking at the sheet instead.
useHotkeys([
  {
    hotkey: 'R',
    callback: () => void refresh(),
    options: { enabled: () => !pending.value && !dialogOpen.value },
  },
  {
    hotkey: 'M',
    callback: () => void loadMore(),
    options: { enabled: () => hasMore.value && !pending.value && !dialogOpen.value },
  },
  {
    hotkey: '/',
    callback: () => auditTable.value?.focusFilter(),
    // Otherwise the slash lands in the field it just focused.
    options: { preventDefault: true, enabled: () => !dialogOpen.value },
  },
]);
</script>
