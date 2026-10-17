<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 grid place-items-center bg-canvas/70 p-4 backdrop-blur-sm"
    @click.self="close"
  >
    <div
      ref="panel"
      class="panel w-full max-w-100 p-0"
      role="dialog"
      aria-modal="true"
      :aria-label="$t('dashboard.shortcuts.title')"
      @keydown.tab="trapFocus"
    >
      <div class="section-title">
        <h2 class="m-0 text-xs font-750 tracking-[0.12em] uppercase">
          {{ $t('dashboard.shortcuts.title') }}
        </h2>
        <button
          ref="closeButton"
          class="btn-icon h-7 w-7"
          type="button"
          :aria-label="$t('common.actions.close')"
          @click="close"
        >
          <Icon aria-hidden="true" class="h-3.5 w-3.5" name="lucide:x" />
        </button>
      </div>

      <ul class="m-0 list-none p-2">
        <li
          v-for="shortcut in APP_SHORTCUTS"
          :key="shortcut.labelKey"
          class="flex items-center justify-between gap-4 px-2.5 py-1.5"
        >
          <span class="text-xs text-ink">{{ $t(shortcut.labelKey) }}</span>
          <span class="flex items-center gap-1">
            <kbd
              v-for="(chord, index) in shortcut.chords"
              :key="index"
              class="border border-line bg-raised px-1.5 py-0.5 font-mono text-3xs text-muted"
            >
              {{ formatForDisplay(chord) }}
            </kbd>
          </span>
        </li>
      </ul>

      <p class="m-0 border-t border-line px-4.5 py-2.5 text-3xs text-muted">
        {{ $t('dashboard.shortcuts.hint') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatForDisplay, useHotkey } from '@tanstack/vue-hotkeys';

import { APP_SHORTCUTS, useShortcutsDialog } from '../../composables/useAppShortcuts';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const open = useShortcutsDialog();
const panel = useTemplateRef<HTMLDivElement>('panel');
const closeButton = useTemplateRef<HTMLButtonElement>('closeButton');

/** Who to hand focus back to once the sheet closes; captured just before focus moves into it. */
let opener: HTMLElement | null = null;

function close(): void {
  open.value = false;
}

/**
 * Keeps Tab cycling inside the sheet instead of reaching whatever `aria-modal` says it covers.
 * Queried live rather than fixed to the close button, so a future second focusable row stays
 * trapped correctly without this needing to change.
 */
function trapFocus(event: KeyboardEvent): void {
  const focusable = [...(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// `ignoreInputs: false` so Escape still closes the sheet from a focused control inside it; every
// other shortcut deliberately keeps the default of staying out of text fields.
useHotkey('Escape', close, { enabled: open, ignoreInputs: false });

// Focus moves into the sheet when it opens, so the close button — and Escape — are reachable
// without a pointer, and the reader is not left tabbing behind the overlay. It moves back to
// whatever had focus before the sheet opened when it closes, rather than leaving the reader
// wherever the (now invisible) close button used to be.
watch(open, async (isOpen) => {
  if (isOpen) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    closeButton.value?.focus();
    return;
  }
  opener?.focus();
  opener = null;
});
</script>
