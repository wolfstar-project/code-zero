<template>
  <button
    class="btn-icon"
    type="button"
    :aria-label="label"
    :title="label"
    @click="toggleColorMode"
  >
    <Icon aria-hidden="true" class="h-4 w-4" :name="isDark ? 'lucide:sun' : 'lucide:moon'" />
  </button>
</template>

<script setup lang="ts">
const { t } = useI18n();
const colorMode = useColorMode();
const isDark = computed(() => colorMode.value === 'dark');
const label = computed(() =>
  isDark.value ? t('common.theme.switchToLight') : t('common.theme.switchToDark'),
);

function toggleColorMode(): void {
  colorMode.preference = isDark.value ? 'light' : 'dark';
}
</script>
