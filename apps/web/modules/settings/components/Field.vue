<template>
  <!-- A group of checkboxes or radios is one question with one label, so it is a fieldset; a
       single control is labelled by its own `<label for>`. -->
  <fieldset v-if="group" class="m-0 min-w-0 border-0 p-0" :aria-describedby="describedBy">
    <legend class="label-upper p-0">{{ label }}</legend>
    <div class="mt-1.5">
      <slot :id="id" :described-by="describedBy" :invalid="invalid" />
    </div>
    <p v-if="hint" :id="hintId" class="m-0 mt-1.5 text-3xs text-muted">{{ hint }}</p>
    <SettingsIssueList :id="issuesId" :issues="issues" />
  </fieldset>
  <div v-else class="min-w-0">
    <label class="label-upper" :for="id">{{ label }}</label>
    <div class="mt-1.5">
      <slot :id="id" :described-by="describedBy" :invalid="invalid" />
    </div>
    <p v-if="hint" :id="hintId" class="m-0 mt-1.5 text-3xs text-muted">{{ hint }}</p>
    <SettingsIssueList :id="issuesId" :issues="issues" />
  </div>
</template>

<script setup lang="ts">
import type { IssueText } from '../utils/form';

const props = defineProps<{
  label: string;
  hint?: string;
  issues?: readonly IssueText[] | undefined;
  group?: boolean;
}>();

const id = useId();
const hintId = `${id}-hint`;
const issuesId = `${id}-issues`;
const invalid = computed(() => (props.issues?.length ?? 0) > 0);
const describedBy = computed(
  () =>
    [props.hint ? hintId : '', invalid.value ? issuesId : ''].filter(Boolean).join(' ') ||
    undefined,
);
</script>
