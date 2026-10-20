<template>
  <!-- The whole document, read-only: what the file source holds, field for field, in the same
       sections the form edits. -->
  <section class="panel">
    <h2 class="section-title m-0 text-xs">
      {{ $t('dashboard.settings.sections.execution') }}
    </h2>
    <div class="p-4">
      <SettingsExecution :execution="settings.execution" />
    </div>

    <h2 class="section-title m-0 border-t border-line text-xs">
      {{ $t('dashboard.settings.sections.model') }}
    </h2>
    <dl class="m-0 grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
      <template v-if="settings.model">
        <div>
          <dt class="label-upper">{{ $t('dashboard.settings.fields.provider') }}</dt>
          <dd class="m-0 mt-1 mono text-ink">{{ settings.model.provider }}</dd>
        </div>
        <div>
          <dt class="label-upper">{{ $t('dashboard.settings.fields.modelName') }}</dt>
          <dd class="m-0 mt-1 break-all mono text-ink">{{ settings.model.name }}</dd>
        </div>
      </template>
      <div v-else class="sm:col-span-2">
        <dt class="label-upper">{{ $t('dashboard.settings.fields.modelSource') }}</dt>
        <dd class="m-0 mt-1 text-xs text-ink">
          {{ $t('dashboard.settings.values.repositoryChooses') }}
        </dd>
      </div>
    </dl>

    <h2 class="section-title m-0 border-t border-line text-xs">
      {{ $t('dashboard.settings.sections.runner') }}
    </h2>
    <dl class="m-0 grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
      <template v-if="settings.runner">
        <div>
          <dt class="label-upper">{{ $t('dashboard.settings.fields.engine') }}</dt>
          <dd class="m-0 mt-1 mono text-ink">{{ settings.runner.engine }}</dd>
        </div>
        <div>
          <dt class="label-upper">{{ $t('dashboard.settings.fields.image') }}</dt>
          <dd class="m-0 mt-1 break-all mono text-ink">{{ settings.runner.image }}</dd>
        </div>
      </template>
      <div v-else class="sm:col-span-2">
        <dt class="label-upper">{{ $t('dashboard.settings.fields.runnerSource') }}</dt>
        <dd class="m-0 mt-1 text-xs text-ink">
          {{ $t('dashboard.settings.values.repositoryChooses') }}
        </dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import type { DeploymentSettings } from '@code-zero/config';

defineProps<{ settings: DeploymentSettings }>();
</script>
