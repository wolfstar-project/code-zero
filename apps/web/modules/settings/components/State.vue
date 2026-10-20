<template>
  <!-- In place of the page when it cannot be read: why, in this app's own words, and what to do. -->
  <section class="panel px-4 py-10 text-center" :role="kind === 'loading' ? 'status' : 'alert'">
    <Icon
      aria-hidden="true"
      class="mx-auto h-5 w-5"
      :class="[
        kind === 'loading' ? 'animate-spin text-muted' : '',
        kind === 'forbidden' ? 'text-warning' : '',
        kind === 'error' ? 'text-danger' : '',
      ]"
      :name="ICONS[kind]"
    />
    <h2 v-if="title" class="m-0 mt-3 text-sm font-650">{{ title }}</h2>
    <p class="mx-auto mb-0 mt-2 max-w-md text-xs text-muted">{{ message }}</p>
    <button
      v-if="retry"
      class="btn-subtle mx-auto mt-4 gap-2 px-3"
      type="button"
      @click="emit('retry')"
    >
      <Icon aria-hidden="true" class="h-3.5 w-3.5" name="lucide:refresh-cw" />
      {{ $t('dashboard.settings.error.retry') }}
    </button>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  kind: 'loading' | 'forbidden' | 'error';
  title?: string;
  message: string;
  retry?: boolean;
}>();
const emit = defineEmits<{ retry: [] }>();

const ICONS = {
  loading: 'lucide:loader-circle',
  forbidden: 'lucide:shield-alert',
  error: 'lucide:circle-alert',
} as const;
</script>
