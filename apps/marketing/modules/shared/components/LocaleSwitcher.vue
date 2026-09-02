<template>
  <select
    v-model="selected"
    class="input-field font-650 transition hover:border-muted"
    :aria-label="t('common.locale.label')"
    :title="t('common.locale.label')"
  >
    <option v-for="option in options" :key="option.code" :value="option.code">
      {{ option.label }}
    </option>
  </select>
</template>

<script lang="ts">
import { locales } from '@code-zero/i18n';
import type { LocaleCode } from '@code-zero/i18n';

// Module scope, not per-instance: `Header.vue` mounts this component twice (desktop nav and
// mobile menu), and the locale list never changes at runtime, so there is nothing to gain from
// recomputing it once per instance on every page render.
const options = Object.entries(locales).map(([code, definition]) => ({
  code: code as LocaleCode,
  label: definition.label,
}));
</script>

<script setup lang="ts">
const { t, locale, setLocale } = useI18n();

// Bound with `v-model` rather than `:value`: only `v-model` makes the server mark the matching
// `<option>` as selected, and a bare `:value` hydrates into a mismatch.
const selected = ref<LocaleCode>(locale.value as LocaleCode);

watch(locale, (value) => {
  selected.value = value as LocaleCode;
});

// Under the `prefix_except_default` strategy this navigates to the target locale's own URL rather
// than swapping messages in place, which is the whole reason the prefixes exist.
watch(selected, async (value) => {
  if (value !== locale.value) await setLocale(value);
});
</script>
