<template>
  <span
    class="inline-flex items-center gap-1.5 border border-line bg-raised px-1.5 py-0.5 font-mono text-3xs text-muted"
  >
    <Icon aria-hidden="true" class="h-2.5 w-2.5" :name="sourceIcon" />
    {{ $t(sourceLabelKey) }}
  </span>
</template>

<script setup lang="ts">
import type { AuditSource } from '../types/audit';

const props = defineProps<{ source: AuditSource }>();

// Spelled out rather than interpolated, so `i18n:report` can verify both keys exist; the source
// values are kebab-case and the keys are not, so a template literal could not build them anyway.
const SOURCE_LABEL_KEYS: Readonly<Record<AuditSource, string>> = {
  'control-plane': 'dashboard.audit.source.controlPlane',
  authentication: 'dashboard.audit.source.authentication',
};

const SOURCE_ICONS: Readonly<Record<AuditSource, string>> = {
  'control-plane': 'lucide:cpu',
  authentication: 'lucide:key-round',
};

const sourceLabelKey = computed(() => SOURCE_LABEL_KEYS[props.source]);
const sourceIcon = computed(() => SOURCE_ICONS[props.source]);
</script>
