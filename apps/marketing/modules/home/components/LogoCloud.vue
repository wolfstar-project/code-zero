<template>
  <section class="border-y border-line bg-panel/70 py-8">
    <div class="shell grid gap-6 lg:grid-cols-[1fr_2fr] lg:items-center lg:gap-12">
      <h2 class="m-0 text-base text-muted font-500 leading-relaxed">
        {{ $t('marketing.logos.title') }}
      </h2>
      <ul class="m-0 list-none flex flex-wrap items-center gap-x-8 gap-y-4 ps-0 lg:justify-between">
        <li
          v-for="entry in logoCloud"
          :key="entry.id"
          class="flex items-center gap-2 text-base text-ink font-650"
        >
          <Icon aria-hidden="true" class="h-4.5 w-4.5" :name="entry.icon" />
          {{ entry.label }}
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { logoCloud } from '~~/config/content.js';
</script>
