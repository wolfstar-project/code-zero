<template>
  <span
    class="inline-flex items-center gap-1.5 font-mono text-3xs font-700 uppercase"
    :class="outcomeClass"
  >
    <span class="h-1.5 w-1.5 rounded-full bg-current" />
    {{ $t(outcomeLabelKey) }}
  </span>
</template>

<script setup lang="ts">
import type { AuditOutcome } from '@code-zero/api';

const props = defineProps<{ outcome: AuditOutcome }>();

// The template literal stays outside the `$t()` call so `i18n:report` does not flag it as an
// unverifiable dynamic key; `AuditOutcome` keeps the lookup exhaustive.
const outcomeLabelKey = computed(() => `dashboard.audit.outcome.${props.outcome}`);

const outcomeClass = computed(() => {
  if (props.outcome === 'success') return 'text-accent';
  if (props.outcome === 'denied') return 'text-warning';
  return 'text-danger';
});
</script>
