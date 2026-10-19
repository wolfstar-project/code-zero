<template>
  <!-- Issues the server reported about the settings as a whole: why they are refused, or what it
       noticed and ignored. Each names the path it is about, so the fix is one edit. -->
  <section
    v-if="issues.length > 0"
    class="border bg-panel"
    :class="tone === 'danger' ? 'border-danger/50' : 'border-warning/50'"
    :role="tone === 'danger' ? 'alert' : undefined"
    :aria-labelledby="titleId"
  >
    <div class="flex items-start gap-2.5 px-3.5 py-3">
      <Icon
        aria-hidden="true"
        class="mt-0.5 h-4 w-4 shrink-0"
        :class="tone === 'danger' ? 'text-danger' : 'text-warning'"
        :name="tone === 'danger' ? 'lucide:octagon-alert' : 'lucide:triangle-alert'"
      />
      <div class="min-w-0">
        <h2 :id="titleId" class="m-0 text-xs font-650">{{ title }}</h2>
        <p v-if="body" class="m-0 mt-1 text-xs text-muted">{{ body }}</p>
      </div>
    </div>
    <ul class="m-0 list-none border-t border-line p-0" role="list">
      <li
        v-for="(issue, index) in issues"
        :key="index"
        class="grid gap-1 border-b border-line px-3.5 py-2 last:border-b-0"
        :class="issue.path === '$' ? '' : 'sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-3'"
      >
        <!-- `$` is the document as a whole: there is no field to point at, only the message. -->
        <code v-if="issue.path !== '$'" class="break-all mono text-muted">{{ issue.path }}</code>
        <span class="break-words text-xs text-ink">{{ issue.message }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  issues: readonly { path: string; message: string }[];
  tone: 'danger' | 'warning';
  title: string;
  body?: string;
}>();

const titleId = useId();
</script>
