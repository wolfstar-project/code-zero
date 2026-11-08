<template>
  <!--
    One strip of figures: a 1 px gap over the line colour draws every divider, so the grid can
    reflow from two columns to five without per-cell border bookkeeping. The last figure spans the
    row on narrow screens, where five cells would otherwise leave a hole.
  -->
  <dl
    :aria-label="$t('dashboard.metrics.aria')"
    class="m-0 grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-5"
  >
    <div
      v-for="(metric, index) in metrics"
      :key="metric.label"
      class="min-w-0 bg-panel px-4 py-3.5 sm:py-4"
      :class="index === metrics.length - 1 ? 'col-span-2 lg:col-span-1' : ''"
    >
      <dt class="label-upper leading-snug">{{ metric.label }}</dt>
      <dd
        class="m-0 mt-2 truncate font-mono text-xl font-600 tracking-tight sm:text-2xl"
        :class="metric.tone"
      >
        {{ metric.value }}
      </dd>
    </div>
  </dl>
</template>

<script setup lang="ts">
import type { DashboardOverview } from '~~/modules/dashboard/types/dashboard';

const props = defineProps<{ overview: DashboardOverview }>();

const { t, locale } = useI18n();

const metrics = computed(() => [
  {
    label: t('dashboard.metrics.activeRunners'),
    value: props.overview.active.toString(),
    tone: 'text-accent',
  },
  {
    label: t('dashboard.metrics.queuedTasks'),
    value: props.overview.queued.toString(),
    tone: 'text-ink',
  },
  {
    label: t('dashboard.metrics.awaitingApproval'),
    value: props.overview.awaitingApproval.toString(),
    tone: props.overview.awaitingApproval > 0 ? 'text-warning' : 'text-ink',
  },
  {
    label: t('dashboard.metrics.tokens'),
    value: props.overview.totalTokens.toLocaleString(locale.value),
    tone: 'text-ink',
  },
  {
    label: t('dashboard.metrics.recordedCost'),
    value: `$${props.overview.costUsd.toFixed(4)}`,
    tone: 'text-ink',
  },
]);
</script>
