<template>
  <div class="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 mono text-muted">
    <NuxtTime
      class="whitespace-nowrap"
      :datetime="buildTime"
      year="numeric"
      month="short"
      day="numeric"
    />

    <span aria-hidden="true">&middot;</span>

    <!-- A release is the one build whose version names something a visitor can go and read; every
         other channel is identified by the channel itself, because two previews share a version. -->
    <NuxtLink
      v-if="buildInfo.env === 'release'"
      class="text-ink transition hover:text-accent"
      :to="`${repositoryUrl}/releases/tag/v${buildInfo.version}`"
      external
      target="_blank"
      rel="noreferrer"
      :aria-label="t('common.build.releaseAria', { version: buildInfo.version })"
    >
      v{{ buildInfo.version }}
    </NuxtLink>
    <span v-else class="text-ink tracking-wider">{{ buildInfo.env }}</span>

    <template v-if="shortCommit">
      <span aria-hidden="true">&middot;</span>
      <NuxtLink
        class="text-ink transition hover:text-accent"
        :to="`${repositoryUrl}/commit/${buildInfo.commit}`"
        external
        target="_blank"
        rel="noreferrer"
        :aria-label="t('common.build.commitAria', { commit: shortCommit })"
      >
        {{ shortCommit }}
      </NuxtLink>
    </template>
  </div>
</template>

<script setup lang="ts">
import { type BuildInfo, shortenCommit } from '@agent-zero/build-env';

/**
 * The build to render. Defaults to the one this bundle is, and is only ever passed to render a
 * build the running server is not — which is what lets the release branch below be tested at all,
 * since a test run is by definition never a release.
 */
const { buildInfo: override } = defineProps<{ buildInfo?: BuildInfo }>();

const { t } = useI18n();

/**
 * What this build is, resolved by `packages/build-env`.
 *
 * On Vercel every field was resolved while the build ran. Anywhere else the server completed
 * whatever the build could not discover at start-up, so a self-hosted deployment still links the
 * commit it is actually serving rather than showing a placeholder.
 */
const resolved = useBuildInfo();
const buildInfo = computed(() => override ?? resolved);
const buildTime = computed(() => new Date(buildInfo.value.time));

// A build that resolved no commit — a source tarball, a container image whose host was told
// nothing — hides the link rather than pointing it at `/commit/null`.
const shortCommit = computed(() => shortenCommit(buildInfo.value.commit));

const repositoryUrl = 'https://github.com/wolfstar-project/agent-zero';
</script>
