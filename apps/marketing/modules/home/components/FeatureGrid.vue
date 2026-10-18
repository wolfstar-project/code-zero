<template>
  <section id="features" class="section-y scroll-mt-24">
    <div class="shell">
      <div class="grid gap-6 lg:grid-cols-2 lg:gap-16">
        <h2 class="m-0 max-w-xl text-headline font-750 tracking-tight">
          {{ $t('marketing.features.title') }}
        </h2>
        <p class="m-0 max-w-xl lede lg:self-end">{{ $t('marketing.features.subtitle') }}</p>
      </div>

      <ul class="m-0 mt-12 grid list-none gap-x-10 ps-0 sm:grid-cols-2">
        <li
          v-for="feature in featureCards"
          :key="feature.id"
          class="border-t border-line py-8"
          :class="
            feature.layout === 'lead'
              ? 'col-span-full grid gap-4 bg-panel px-6 sm:grid-cols-2 sm:gap-10 sm:px-8'
              : feature.layout === 'wide'
                ? 'sm:col-span-full'
                : undefined
          "
        >
          <h3
            class="m-0 text-lg font-700"
            :class="feature.layout === 'lead' ? 'text-accent' : undefined"
          >
            {{ $t(`marketing.features.items.${feature.id}.title`) }}
          </h3>
          <p
            class="m-0 max-w-2xl text-base text-muted leading-relaxed"
            :class="feature.layout === 'lead' ? undefined : 'mt-3'"
          >
            {{ $t(`marketing.features.items.${feature.id}.description`) }}
          </p>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { featureCards } from '~~/config/content.js';
</script>
