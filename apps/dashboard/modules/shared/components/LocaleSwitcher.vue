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

<script setup lang="ts">
import { locales } from '@code-zero/i18n';
import type { LocaleCode } from '@code-zero/i18n';

const { t, locale, setLocale } = useI18n();

const options = Object.entries(locales).map(([code, definition]) => ({
  code: code as LocaleCode,
  label: definition.label,
}));

// Bound with `v-model` rather than `:value`: only `v-model` makes the server mark the matching
// `<option>` as selected, and a bare `:value` hydrates into a mismatch.
const selected = ref<LocaleCode>(locale.value as LocaleCode);

watch(locale, (value) => {
  selected.value = value as LocaleCode;
});

watch(selected, async (value) => {
  if (value !== locale.value) await setLocale(value);
});
</script>
