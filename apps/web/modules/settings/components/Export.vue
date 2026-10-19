<template>
  <section class="panel" :aria-labelledby="titleId">
    <h2 :id="titleId" class="section-title m-0 text-xs">
      {{ $t('dashboard.settings.export.title') }}
    </h2>
    <div class="p-4">
      <p class="m-0 text-xs text-muted">{{ $t('dashboard.settings.export.body') }}</p>
      <p v-if="!available" class="m-0 mt-2 text-xs text-warning">
        {{ $t('dashboard.settings.export.unavailable') }}
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          class="btn-subtle gap-2 px-3"
          type="button"
          :disabled="!available || pending"
          @click="download"
        >
          <Icon aria-hidden="true" class="h-3.5 w-3.5" name="lucide:download" />
          {{ $t('dashboard.settings.export.download') }}
        </button>
        <button
          class="btn-subtle gap-2 px-3"
          type="button"
          :disabled="!available || pending"
          @click="copy"
        >
          <Icon
            aria-hidden="true"
            class="h-3.5 w-3.5"
            :name="copied ? 'lucide:check' : 'lucide:copy'"
          />
          {{
            copied ? $t('dashboard.settings.export.copied') : $t('dashboard.settings.export.copy')
          }}
        </button>
      </div>
      <p v-if="error || copyFailed" class="m-0 mt-2 text-xs text-danger" role="alert">
        {{
          copyFailed
            ? $t('dashboard.settings.export.copyFailed')
            : $t('dashboard.settings.export.error')
        }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { SettingsExporter } from '../composables/useSettingsExport';

const props = defineProps<{ available: boolean; exporter: SettingsExporter }>();

const titleId = useId();
const { pending, error, load } = useSettingsExport(() => props.exporter());
const copied = shallowRef(false);
const copyFailed = shallowRef(false);

/** Fetched fresh on every click, so the file is what the server holds now, not when the page loaded. */
async function download(): Promise<void> {
  const yaml = await load();
  if (yaml === null) return;
  const url = URL.createObjectURL(new Blob([yaml], { type: 'application/yaml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'config.yml';
  link.click();
  URL.revokeObjectURL(url);
}

async function copy(): Promise<void> {
  copyFailed.value = false;
  const yaml = await load();
  if (yaml === null) return;
  try {
    await navigator.clipboard.writeText(yaml);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    copyFailed.value = true;
  }
}
</script>
