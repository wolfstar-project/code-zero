<template>
  <dl class="m-0 grid gap-x-6 gap-y-3 sm:grid-cols-2">
    <div>
      <dt class="label-upper">{{ $t('dashboard.settings.fields.maxConcurrentTasks') }}</dt>
      <dd class="m-0 mt-1 mono text-ink">{{ execution.maxConcurrentTasks }}</dd>
    </div>
    <div>
      <dt class="label-upper">{{ $t('dashboard.settings.fields.commandTimeoutMinutes') }}</dt>
      <dd class="m-0 mt-1 mono text-ink">
        {{ $t('dashboard.settings.values.minutes', { count: execution.commandTimeoutMinutes }) }}
      </dd>
    </div>
    <div>
      <dt class="label-upper">{{ $t('dashboard.settings.fields.allowedModes') }}</dt>
      <dd class="m-0 mt-1 flex flex-wrap gap-1.5">
        <span v-for="mode in execution.allowedModes" :key="mode" class="chip">
          {{ $t(MODE_LABEL_KEYS[mode]) }}
        </span>
      </dd>
    </div>
    <div>
      <dt class="label-upper">{{ $t('dashboard.settings.fields.maxNetwork') }}</dt>
      <dd class="m-0 mt-1 text-xs text-ink">{{ $t(NETWORK_LABEL_KEYS[execution.maxNetwork]) }}</dd>
    </div>
  </dl>
</template>

<script setup lang="ts">
import type { ExecutionSettings } from '@code-zero/config';

import { MODE_LABEL_KEYS, NETWORK_LABEL_KEYS } from '../utils/labels';

defineProps<{ execution: ExecutionSettings }>();
</script>
