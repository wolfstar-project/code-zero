<template>
  <section class="section-y">
    <div class="shell">
      <div
        class="panel grid gap-8 border-accent/35 px-6 py-10 sm:px-10 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-12 lg:py-14"
      >
        <div>
          <h2 class="m-0 text-headline font-750 tracking-tight">{{ $t('marketing.cta.title') }}</h2>
          <p class="m-0 mt-4 max-w-xl lede">{{ $t('marketing.cta.subtitle') }}</p>
        </div>
        <div class="flex flex-col gap-3 sm:flex-row lg:flex-col">
          <a class="btn btn-accent h-11 text-base" :href="dashboardUrl">
            {{ $t('marketing.cta.primary') }}
            <Icon aria-hidden="true" class="h-4 w-4 rtl:scale-x-[-1]" name="lucide:arrow-right" />
          </a>
          <NuxtLink class="btn btn-subtle h-11 text-base" :to="localePath({ path: '/contact' })">
            {{ $t('marketing.cta.secondary') }}
          </NuxtLink>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
const localePath = useLocalePath();
const dashboardUrl = useRuntimeConfig().public.dashboardUrl;
</script>
