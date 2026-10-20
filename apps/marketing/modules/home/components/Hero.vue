<template>
  <section class="py-16 sm:py-24 lg:py-28">
    <div class="shell grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
      <div class="min-w-0">
        <p class="m-0 text-sm text-accent font-650">{{ $t('marketing.hero.eyebrow') }}</p>
        <h1 class="m-0 mt-6 max-w-2xl text-display font-750 tracking-tight">
          {{ $t('marketing.hero.title') }}
        </h1>
        <p class="m-0 mt-6 max-w-xl lede">{{ $t('marketing.hero.subtitle') }}</p>

        <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <NuxtLink class="btn btn-accent h-11 text-base" :to="localePath({ path: '/pricing' })">
            {{ $t('marketing.hero.primaryCta') }}
            <Icon aria-hidden="true" class="h-4 w-4 rtl:scale-x-[-1]" name="lucide:arrow-right" />
          </NuxtLink>
          <NuxtLink
            class="btn btn-subtle h-11 text-base"
            :to="links.docs"
            external
            target="_blank"
            rel="noreferrer"
          >
            {{ $t('marketing.hero.secondaryCta') }}
          </NuxtLink>
        </div>

        <p class="m-0 mt-5 text-sm text-muted">
          {{ $t('marketing.hero.note') }}
        </p>
      </div>

      <figure class="m-0 min-w-0">
        <div class="panel overflow-hidden border-muted/45">
          <div class="min-h-12 flex items-center border-b border-line bg-raised px-5">
            <span class="text-sm text-muted font-650">{{
              $t('marketing.hero.terminalTitle')
            }}</span>
          </div>
          <!-- A transcript rather than a screenshot: it stays legible in both themes, needs no
               image request on the critical path, and is readable by a screen reader. -->
          <div
            class="focus-ring overflow-x-auto p-5 sm:p-6"
            role="region"
            :aria-label="$t('marketing.hero.terminalTitle')"
            tabindex="0"
          >
            <p class="m-0 whitespace-nowrap font-mono text-sm text-accent">
              $ zero review --proactive
            </p>
            <pre
              class="m-0 mt-6 font-mono text-sm text-ink leading-relaxed"
            ><code>{{ transcript }}</code></pre>
          </div>
        </div>
        <figcaption class="mt-4 text-sm text-muted leading-relaxed">
          {{ $t('marketing.hero.terminalCaption') }}
        </figcaption>
      </figure>
    </div>
  </section>
</template>

<script setup lang="ts">
const localePath = useLocalePath();

// Static sample output, not a live run: the marketing site holds no credentials and never calls
// the runtime. Kept verbatim rather than translated because it is program output, not prose.
const transcript = `| Property | Value |
| --- | --- |
| Mode | \`observe\` |

### Finding
No finding was produced.

### Checks
No repository-native checks were executed.`;
</script>
