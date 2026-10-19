<template>
  <div
    class="flex flex-col gap-3 border-t border-line p-4 sm:flex-row sm:items-center sm:justify-between"
  >
    <!-- One live region for the outcome, so a screen reader hears "saved" or "refused" once,
         wherever focus is. -->
    <div class="min-w-0" aria-live="polite">
      <p v-if="saved" class="m-0 flex items-center gap-1.5 text-xs text-accent">
        <Icon aria-hidden="true" class="h-3.5 w-3.5" name="lucide:check" />
        {{ savedMessage ?? $t('dashboard.settings.form.saved') }}
      </p>
      <template v-else-if="error">
        <p class="m-0 text-xs text-danger">{{ $t(SAVE_ERROR_KEYS[error]) }}</p>
        <SettingsIssueList :issues="formIssues" />
      </template>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <button
        class="btn-subtle px-3"
        type="button"
        :disabled="saving || !dirty"
        @click="emit('reset')"
      >
        {{ $t('dashboard.settings.form.reset') }}
      </button>
      <button class="btn-accent gap-2 px-3" type="submit" :disabled="saving">
        <Icon
          aria-hidden="true"
          class="h-3.5 w-3.5"
          :class="saving ? 'animate-spin' : ''"
          :name="saving ? 'lucide:loader-circle' : 'lucide:save'"
        />
        {{ saving ? $t('dashboard.settings.form.saving') : saveLabel }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { IssueText, SettingsError } from '../utils/form';
import { SAVE_ERROR_KEYS } from '../utils/labels';

defineProps<{
  error: SettingsError | null;
  formIssues?: readonly IssueText[] | undefined;
  saved: boolean;
  saving: boolean;
  dirty: boolean;
  saveLabel: string;
  savedMessage?: string;
}>();

const emit = defineEmits<{ reset: [] }>();
</script>
