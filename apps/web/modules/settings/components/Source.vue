<template>
  <!-- Says where the settings come from before anything else on the page, because it decides
       whether the rest is a form or a record. -->
  <section class="panel" :aria-labelledby="titleId">
    <h2 :id="titleId" class="section-title m-0 text-xs">
      {{ $t('dashboard.settings.source.title') }}
    </h2>
    <dl class="m-0 grid gap-3 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <dt class="label-upper">{{ $t('dashboard.settings.source.edition') }}</dt>
        <dd class="m-0">
          <span class="chip">
            {{
              view.edition === 'cloud'
                ? $t('dashboard.settings.source.editions.cloud')
                : $t('dashboard.settings.source.editions.selfHosted')
            }}
          </span>
        </dd>
      </div>

      <template v-if="view.edition === 'self-hosted'">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <dt class="label-upper">{{ $t('dashboard.settings.source.source') }}</dt>
          <dd class="m-0">
            <span
              class="chip"
              :class="view.source === 'dashboard' ? 'border-accent/45 text-accent' : ''"
            >
              <Icon
                aria-hidden="true"
                class="h-3 w-3"
                :name="view.source === 'file' ? 'lucide:file-lock' : 'lucide:database'"
              />
              {{
                view.source === 'file'
                  ? $t('dashboard.settings.source.sources.file')
                  : $t('dashboard.settings.source.sources.dashboard')
              }}
            </span>
          </dd>
        </div>

        <div v-if="view.filePath">
          <dt class="label-upper">{{ $t('dashboard.settings.source.file') }}</dt>
          <dd class="m-0 mt-1 break-all mono text-ink">{{ view.filePath }}</dd>
        </div>

        <div v-if="view.source === 'dashboard' && view.state.ok">
          <dt class="label-upper">{{ $t('dashboard.settings.source.saved') }}</dt>
          <dd v-if="view.state.saved" class="m-0 mt-1 text-xs text-ink">
            <span class="font-650">{{ view.state.saved.by }}</span>
            <span class="text-muted"> · </span>
            <time class="mono text-muted" :datetime="view.state.saved.at">
              {{ formatTimestamp(view.state.saved.at) }}
            </time>
          </dd>
          <dd v-else class="m-0 mt-1 text-xs text-muted">
            {{ $t('dashboard.settings.source.neverSaved') }}
          </dd>
        </div>
      </template>
    </dl>

    <p class="m-0 border-t border-line px-4 py-3 text-xs text-muted">{{ explanation }}</p>
    <p
      v-if="view.edition === 'self-hosted'"
      class="m-0 border-t border-line px-4 py-3 text-3xs text-muted"
    >
      {{ $t('dashboard.settings.source.switchHint') }}
    </p>
  </section>
</template>

<script setup lang="ts">
import type { SettingsView } from '@code-zero/api';

import { formatTimestamp } from '../utils/labels';

const props = defineProps<{ view: SettingsView }>();

const { t } = useI18n();
const titleId = useId();

const explanation = computed(() => {
  if (props.view.edition === 'cloud') return t('dashboard.settings.source.cloudHint');
  return props.view.source === 'file'
    ? t('dashboard.settings.source.fileHint')
    : t('dashboard.settings.source.dashboardHint');
});
</script>
