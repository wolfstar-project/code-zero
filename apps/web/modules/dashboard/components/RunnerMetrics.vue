<template>
  <section :aria-label="$t('dashboard.metrics.aria')" class="panel grid grid-cols-2 lg:grid-cols-5">
    <div
      v-for="(metric, index) in metrics"
      :key="metric.label"
      class="min-h-22 flex items-center gap-3 border-line p-3.5 sm:p-4"
      :class="[
        index % 2 === 0 ? 'border-r' : '',
        index < 4 ? 'border-b lg:border-b-0 lg:border-r' : '',
      ]"
    >
      <div class="h-9 w-9 shrink-0 grid place-items-center border border-line bg-raised">
        <Icon aria-hidden="true" class="h-4 w-4 text-muted" :name="metric.icon" />
      </div>
      <div class="min-w-0">
        <p class="m-0 text-4xs text-muted font-700 tracking-[0.16em] uppercase">
          {{ metric.label }}
        </p>
        <p
          class="m-0 mt-1.5 truncate font-mono text-xl font-600 tracking-tight"
          :class="metric.tone"
        >
          {{ metric.value }}
        </p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DashboardOverview } from '~~/modules/dashboard/types/dashboard';

const props = defineProps<{ overview: DashboardOverview }>();

const { t, locale } = useI18n();

const metrics = computed(() => [
  {
    label: t('dashboard.metrics.activeRunners'),
    value: props.overview.active.toString(),
    icon: 'lucide:server',
    tone: 'text-accent',
  },
  {
    label: t('dashboard.metrics.queuedTasks'),
    value: props.overview.queued.toString(),
    icon: 'lucide:list-todo',
    tone: 'text-ink',
  },
  {
    label: t('dashboard.metrics.awaitingApproval'),
    value: props.overview.awaitingApproval.toString(),
    icon: 'lucide:hourglass',
    tone: props.overview.awaitingApproval > 0 ? 'text-warning' : 'text-ink',
  },
  {
    label: t('dashboard.metrics.tokens'),
    value: props.overview.totalTokens.toLocaleString(locale.value),
    icon: 'lucide:coins',
    tone: 'text-ink',
  },
  {
    label: t('dashboard.metrics.recordedCost'),
    value: `$${props.overview.costUsd.toFixed(4)}`,
    icon: 'lucide:circle-dollar-sign',
    tone: 'text-ink',
  },
]);
</script>
