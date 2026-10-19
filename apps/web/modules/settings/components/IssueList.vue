<template>
  <ul v-if="issues && issues.length > 0" :id="id" class="m-0 mt-1.5 list-none p-0" role="list">
    <li
      v-for="(issue, index) in issues"
      :key="index"
      class="flex items-start gap-1.5 text-3xs text-danger"
    >
      <Icon aria-hidden="true" class="mt-px h-3 w-3 shrink-0" name="lucide:circle-alert" />
      <span>{{ 'key' in issue ? $t(issue.key) : issue.text }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { IssueText } from '../utils/form';

defineProps<{ id?: string; issues?: readonly IssueText[] | undefined }>();
</script>
