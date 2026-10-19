<template>
  <section class="panel" :aria-labelledby="titleId">
    <h2 :id="titleId" class="section-title m-0 text-xs">
      {{ $t('dashboard.settings.services.title') }}
    </h2>
    <ul class="m-0 list-none p-0" role="list">
      <li
        v-for="entry in services"
        :key="entry.service"
        class="h-9 flex items-center justify-between gap-3 border-b border-line px-3.5 last:border-b-0"
      >
        <span class="text-xs text-ink">{{ $t(SERVICE_LABEL_KEYS[entry.service]) }}</span>
        <span
          class="flex items-center gap-1.5 text-3xs font-650"
          :class="entry.configured ? 'text-accent' : 'text-warning'"
        >
          <span
            aria-hidden="true"
            class="h-1.5 w-1.5 rounded-full"
            :class="entry.configured ? 'bg-accent' : 'bg-warning'"
          />
          {{
            entry.configured
              ? $t('dashboard.settings.services.configured')
              : $t('dashboard.settings.services.missing')
          }}
        </span>
      </li>
    </ul>
    <p class="m-0 border-t border-line px-3.5 py-2.5 text-3xs text-muted">
      {{ $t('dashboard.settings.services.caption') }}
    </p>
  </section>
</template>

<script setup lang="ts">
import type { ServiceStatus } from '@code-zero/api';

import { SERVICE_LABEL_KEYS } from '../utils/labels';

defineProps<{ services: readonly ServiceStatus[] }>();

const titleId = useId();
</script>
