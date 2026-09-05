<template>
  <aside class="panel min-h-120 overflow-hidden xl:sticky xl:top-20 xl:h-fit">
    <div class="section-title">
      <h2 class="m-0 text-xs font-750 tracking-[0.12em] uppercase">
        {{ $t('dashboard.inspector.title') }}
      </h2>
      <span class="h-1.5 w-1.5 rounded-full" :class="task ? 'bg-accent' : 'bg-muted'" />
    </div>

    <div v-if="task" class="p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="m-0 mono text-link">{{ task.id }}</p>
          <p class="m-0 mt-1 truncate text-xs text-muted">{{ task.repository }}</p>
        </div>
        <TaskStatus :status="task.status" />
      </div>

      <dl class="my-4 grid grid-cols-2 border border-line">
        <div class="border-b border-ie border-line p-3">
          <dt class="label-upper">
            {{ $t('dashboard.inspector.created') }}
          </dt>
          <dd class="mb-0 ms-0 mt-1.5 font-mono text-3xs text-ink">
            {{ new Date(task.createdAt).toLocaleString(locale) }}
          </dd>
        </div>
        <div class="border-b border-line p-3">
          <dt class="label-upper">
            {{ $t('dashboard.inspector.attempts') }}
          </dt>
          <dd class="mb-0 ms-0 mt-1.5 font-mono text-3xs text-ink">
            {{ task.result?.attempts ?? '—' }}
          </dd>
        </div>
        <div class="border-ie border-line p-3">
          <dt class="label-upper">
            {{ $t('dashboard.inspector.tokens') }}
          </dt>
          <dd class="mb-0 ms-0 mt-1.5 font-mono text-3xs text-ink">
            {{ task.result?.usage.totalTokens.toLocaleString(locale) ?? '—' }}
          </dd>
        </div>
        <div class="p-3">
          <dt class="label-upper">
            {{ $t('dashboard.inspector.verified') }}
          </dt>
          <dd
            class="mb-0 ms-0 mt-1.5 font-mono text-3xs"
            :class="task.result?.verified ? 'text-accent' : 'text-muted'"
          >
            {{
              task.result
                ? task.result.verified
                  ? $t('dashboard.inspector.yes')
                  : $t('dashboard.inspector.no')
                : '—'
            }}
          </dd>
        </div>
      </dl>

      <div v-if="task.result" class="border border-line bg-raised/45 p-3">
        <p class="m-0 label-upper">
          {{ $t('dashboard.inspector.summary') }}
        </p>
        <p class="mb-0 mt-2 text-xs text-ink leading-relaxed">{{ task.result.summary }}</p>
      </div>

      <!--
        A run that stopped for a person is the one thing on this page that cannot resolve itself.
        The decision is recorded against the signed-in principal; the comment is optional and the
        server truncates nothing, so it stays short by the field rather than by trust.
      -->
      <form
        v-if="awaitingDecision"
        class="mt-4 border border-warning/45 bg-warning/5 p-3"
        @submit.prevent="emit('decide', { decision: 'approved', comment: comment.trim() })"
      >
        <p class="m-0 label-upper">{{ $t('dashboard.inspector.approval.title') }}</p>
        <p class="mb-0 mt-2 text-xs text-muted leading-relaxed">
          {{ $t('dashboard.inspector.approval.body') }}
        </p>
        <label class="mt-3 block">
          <span class="label-upper">{{ $t('dashboard.inspector.approval.comment') }}</span>
          <textarea
            v-model="comment"
            class="mt-1.5 w-full border border-line bg-canvas p-2 text-xs text-ink"
            :maxlength="COMMENT_LIMIT"
            rows="2"
            :disabled="pending"
          />
        </label>
        <p v-if="error" class="mb-0 mt-2 text-xs text-error">{{ error }}</p>
        <div class="mt-3 flex gap-2">
          <button class="btn-primary px-3" type="submit" :disabled="pending">
            {{ $t('dashboard.inspector.approval.approve') }}
          </button>
          <button
            class="btn-subtle px-3"
            type="button"
            :disabled="pending"
            @click="emit('decide', { decision: 'rejected', comment: comment.trim() })"
          >
            {{ $t('dashboard.inspector.approval.reject') }}
          </button>
        </div>
      </form>

      <div v-else-if="task.approval" class="mt-4 border border-line bg-raised/45 p-3">
        <p class="m-0 label-upper">{{ $t('dashboard.inspector.approval.decided') }}</p>
        <p class="mb-0 mt-2 text-xs text-ink leading-relaxed">
          {{
            $t(`dashboard.inspector.approval.${task.approval.decision}`) +
            ' · ' +
            task.approval.actor +
            ' · ' +
            new Date(task.approval.decidedAt).toLocaleString(locale)
          }}
        </p>
        <p v-if="task.approval.comment" class="mb-0 mt-2 text-xs text-muted leading-relaxed">
          {{ task.approval.comment }}
        </p>
      </div>
    </div>

    <div v-else class="min-h-120 grid place-items-center px-6 text-center">
      <div>
        <div class="mx-auto h-10 w-10 grid place-items-center border border-line bg-raised">
          <Icon aria-hidden="true" class="h-4 w-4 text-muted" name="lucide:search" />
        </div>
        <h3 class="mb-0 mt-4 text-sm font-650">{{ $t('dashboard.inspector.emptyTitle') }}</h3>
        <p class="mb-0 mt-2 text-xs text-muted leading-relaxed">
          {{ $t('dashboard.inspector.emptyBody') }}
        </p>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { DashboardTask } from '~~/modules/dashboard/types/dashboard';

/** `approvalInput` caps the comment at the same length; the field says so before the server does. */
const COMMENT_LIMIT = 2_000;

const props = defineProps<{ task?: DashboardTask; pending?: boolean; error?: string }>();

/**
 * The decision is emitted rather than sent from here. The page owns the typed client and the one
 * place errors are surfaced, so a component that also mutated would be a second path to keep in
 * step with it.
 */
const emit = defineEmits<{
  decide: [decision: { decision: 'approved' | 'rejected'; comment: string }];
}>();

const { locale } = useI18n();
const comment = ref('');

/** The same condition `dashboardOverview` counts: stopped for a person, and nobody has answered. */
const awaitingDecision = computed(
  () => props.task?.status === 'needs-human' && props.task.approval === undefined,
);

// A decision belongs to the task it was typed for; carrying it to the next selection would attach
// a reason to a run it was never about.
watch(
  () => props.task?.id,
  () => {
    comment.value = '';
  },
);
</script>
