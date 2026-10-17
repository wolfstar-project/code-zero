<template>
  <section class="panel">
    <div class="section-title">
      <h2 class="m-0 text-xs font-750 tracking-[0.12em] uppercase">
        {{ $t('dashboard.timeline.title') }}
      </h2>
      <span class="mono text-muted">
        {{ $t('dashboard.timeline.events', { count: task?.events.length ?? 0 }) }}
      </span>
    </div>

    <div v-if="task && task.events.length > 0" class="max-h-72 overflow-auto px-4 py-3">
      <ol class="m-0 list-none p-0">
        <li
          v-for="(event, index) in task.events"
          :key="`${event.timestamp}-${index}`"
          class="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-3 pb-4 last:pb-1"
        >
          <div
            v-if="index < task.events.length - 1"
            class="absolute bottom-0 inset-is-[0.44rem] top-5 w-px bg-line"
          />
          <Icon
            aria-hidden="true"
            class="relative mt-0.5 h-4 w-4 shrink-0 text-accent"
            name="lucide:circle-check"
          />
          <div>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="m-0 font-mono text-3xs text-accent font-700 uppercase">
                {{ event.state }}
              </p>
              <time class="font-mono text-4xs text-muted">{{ event.timestamp }}</time>
            </div>
            <p class="mb-0 mt-1 text-xs text-muted leading-relaxed">{{ event.message }}</p>
          </div>
        </li>
      </ol>
    </div>

    <div v-else class="h-30 flex items-center justify-center px-4 text-center text-xs text-muted">
      {{ $t('dashboard.timeline.empty') }}
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DashboardTask } from '~~/modules/dashboard/types/dashboard';

defineProps<{ task?: DashboardTask }>();
</script>
