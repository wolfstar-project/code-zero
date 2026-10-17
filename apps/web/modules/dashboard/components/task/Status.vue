<template>
  <span
    class="inline-flex items-center gap-1.5 font-mono text-3xs font-700 uppercase"
    :class="statusClass"
  >
    <span class="h-1.5 w-1.5 rounded-full bg-current" />
    {{ $t(statusLabelKey) }}
  </span>
</template>

<script setup lang="ts">
import type { DashboardTaskStatus } from '~~/modules/dashboard/types/dashboard';

const props = defineProps<{ status: DashboardTaskStatus }>();

// The template literal stays outside the `$t()` call so `i18n:report` does not flag it as an
// unverifiable dynamic key; `DashboardTaskStatus` keeps the lookup exhaustive.
const statusLabelKey = computed(() => `dashboard.status.${props.status}`);

const statusClass = computed(() => {
  if (props.status === 'completed') return 'text-accent';
  if (props.status === 'needs-human') return 'text-warning';
  if (props.status === 'failed') return 'text-danger';
  if (props.status === 'running') return 'text-accent';
  return 'text-muted';
});
</script>
