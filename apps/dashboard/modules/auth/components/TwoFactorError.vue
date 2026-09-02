<template>
  <p
    v-if="message"
    class="m-0 border border-danger/35 bg-danger/8 p-2.5 text-xs text-danger"
    role="alert"
  >
    {{ message }}
  </p>
</template>

<script setup lang="ts">
defineProps<{ message?: string }>();
</script>
