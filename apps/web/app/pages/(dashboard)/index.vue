<template>
  <header
    class="h-16 flex items-center justify-between border-b border-line bg-canvas/92 px-4 backdrop-blur md:px-6"
  >
    <div>
      <p class="m-0 text-3xs text-muted font-700 tracking-[0.18em] uppercase">
        {{ $t('dashboard.header.eyebrow') }}
      </p>
      <h1 class="m-0 mt-1 text-lg font-650 tracking-tight">{{ $t('dashboard.header.title') }}</h1>
    </div>

    <div class="flex items-center gap-3">
      <div class="hidden h-9 items-center gap-2 border border-line bg-raised px-3 lg:flex">
        <span class="label-upper">{{ $t('dashboard.header.mode') }}</span>
      </div>
      <!--
        Says whether the board is following the control plane right now. Without it a stalled
        stream is indistinguishable from a quiet one, and a quiet board is exactly what an
        operator would take as "nothing is happening".
      -->
      <ClientOnly>
        <div
          class="hidden h-9 items-center gap-2 border border-line bg-raised px-3 sm:flex"
          :aria-label="live ? $t('dashboard.header.liveAria') : $t('dashboard.header.staleAria')"
          role="status"
        >
          <span
            aria-hidden="true"
            class="h-1.5 w-1.5 rounded-full"
            :class="live ? 'bg-accent' : 'bg-muted'"
          />
          <span class="label-upper">
            {{ live ? $t('dashboard.header.live') : $t('dashboard.header.stale') }}
          </span>
        </div>
      </ClientOnly>
      <ClientOnly>
        <div class="hidden h-9 items-center gap-2 border border-line bg-raised px-3 sm:flex">
          <Icon aria-hidden="true" class="h-3.5 w-3.5 text-muted" name="lucide:clock-3" />
          <span class="mono text-ink">{{ now.toISOString().slice(0, 19) }}Z</span>
        </div>
      </ClientOnly>
      <LocaleSwitcher />
      <ClientOnly>
        <ColorModeToggle />
        <template #fallback>
          <span class="h-9 w-9 border border-line bg-raised" aria-hidden="true" />
        </template>
      </ClientOnly>
      <button class="btn-subtle gap-2 px-3" type="button" @click="refreshDashboard">
        <Icon aria-hidden="true" class="h-3.5 w-3.5" name="lucide:refresh-cw" />
        {{ $t('common.actions.refresh') }}
      </button>
      <div
        aria-hidden="true"
        class="h-9 w-9 hidden place-items-center border border-accent/45 bg-accent/8 font-mono text-xs text-accent font-700 sm:grid"
      >
        AZ
      </div>
    </div>
  </header>

  <div class="p-3 sm:p-4 md:p-5">
    <RunnerMetrics :overview="overview" />

    <NewTaskForm class="mt-4" :pending="createPending" :error="createError" @submit="createTask" />

    <section class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div class="min-w-0 space-y-4">
        <TaskTable
          ref="taskTable"
          :tasks="overview.tasks"
          :selected-id="selectedId"
          @select="selectedId = $event"
        />
        <TaskTimeline :task="selectedTask" />
      </div>

      <TaskInspector
        :task="selectedTask"
        :pending="decisionPending"
        :error="decisionError"
        @decide="recordDecision"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { useHotkeys } from '@tanstack/vue-hotkeys';
import { useQuery } from '@tanstack/vue-query';
import type { NewTaskRequest } from '~~/modules/dashboard/components/NewTaskForm.vue';
import type { DashboardOverview } from '~~/modules/dashboard/types/dashboard';

/**
 * What the page renders before the first response arrives, and after a failed one.
 *
 * The components below take a populated shape rather than a nullable one, so the empty overview is
 * a real value instead of a `v-if` around the whole page: an operator whose control plane is
 * unreachable still gets the shell and the zero counters, not a blank screen.
 */
const emptyOverview = (): DashboardOverview => ({
  tasks: [],
  active: 0,
  queued: 0,
  awaitingApproval: 0,
  totalTokens: 0,
  costUsd: 0,
});

/**
 * The aggregate read model, fetched through the typed oRPC client.
 *
 * `useQuery` rather than `useSuspenseQuery`, so the server render does not block on the control
 * plane: the first paint is the shell with zero counters and the data arrives after hydration.
 * That is the deliberate trade — a slow or unreachable control plane must not hold up the whole
 * document — and it is why `emptyOverview()` above is a real value rather than a nullable one.
 *
 * `$orpcQuery` is provided by `app/plugins/orpc.client.ts`; its `orpc.server.ts` twin exists for
 * the same key during SSR, and matters for anything that *does* fetch server-side, since it is the
 * half that forwards the request's cookie.
 */
const { $orpc, $orpcQuery } = useNuxtApp();
const { t } = useI18n();
const overviewQuery = $orpcQuery.dashboard.overview.queryOptions();
const { data, refetch } = useQuery(overviewQuery);

/**
 * The board follows the control plane as it works, rather than showing whatever the last fetch
 * happened to catch. A run records its lifecycle events as they happen, so without this a task
 * appears and then sits at whatever state it had when the page loaded until someone refreshes.
 *
 * `refresh` stays: a stream that dropped is exactly when a person reaches for it.
 */
const { connected, stale } = useLiveOverview(overviewQuery.queryKey);

/** One flag for the header: connected and current. Either half failing reads the same to a person. */
const live = computed(() => connected.value && !stale.value);

const overview = computed<DashboardOverview>(() => data.value ?? emptyOverview());
const selectedId = ref<string>();
const now = ref(new Date());

const selectedTask = computed(() =>
  overview.value.tasks.find((task) => task.id === selectedId.value),
);

watch(
  () => overview.value.tasks,
  (tasks) => {
    if (tasks.length === 0) selectedId.value = undefined;
    else if (!tasks.some((task) => task.id === selectedId.value)) selectedId.value = tasks[0]?.id;
  },
  { immediate: true },
);

let clockTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 1_000);
});

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
});

const decisionPending = ref(false);
const decisionError = ref<string>();
const createPending = ref(false);
const createError = ref<string>();

/**
 * Queues a task through the control plane.
 *
 * The record is persisted before the run is scheduled, so the board shows it through the live
 * stream while this call is still open — the response only decides whether an error is reported,
 * not when the task appears.
 */
async function createTask(request: NewTaskRequest): Promise<void> {
  if (createPending.value) return;
  createPending.value = true;
  createError.value = undefined;
  try {
    await $orpc.tasks.create(request);
  } catch {
    // Refusals name a rule, not a value, but the server's text is still untrusted input this page
    // would render; the trail records which rule refused.
    createError.value = t('dashboard.newTask.failed');
  } finally {
    createPending.value = false;
  }
}

/**
 * Records a human decision on the selected task.
 *
 * Nothing is written into the cache here: the decision lands in the store, and the store is what
 * `/api/events` pushes back, so the board updates from the same source every other client sees
 * rather than from an optimistic guess this page made about what the server did.
 */
async function recordDecision(decision: {
  decision: 'approved' | 'rejected';
  comment: string;
}): Promise<void> {
  const task = selectedTask.value;
  if (!task || decisionPending.value) return;
  decisionPending.value = true;
  decisionError.value = undefined;
  try {
    await $orpc.approvals.decide({
      taskId: task.id,
      decision: decision.decision,
      ...(decision.comment === '' ? {} : { comment: decision.comment }),
    });
  } catch {
    // The server's own text is untrusted input the page would render; the outcome is what the
    // operator needs, and the trail carries the rest.
    decisionError.value = t('dashboard.inspector.approval.failed');
  } finally {
    decisionPending.value = false;
  }
}

/** Refetches rather than clearing: the button says refresh, and it used to only blank the page. */
function refreshDashboard(): void {
  now.value = new Date();
  void refetch();
}

// Typed structurally rather than with `InstanceType`: the component is globally registered by the
// dashboard module, so there is no import here to take a type from.
const taskTable = useTemplateRef<{ focusFilter: () => void; orderedIds: string[] }>('taskTable');

/**
 * Walks the selection through the rows as they are displayed, which is what the table exposes:
 * sorting and filtering both reorder the queue, so `overview.tasks` is the wrong list to step.
 */
function moveSelection(offset: number): void {
  const ids = taskTable.value?.orderedIds ?? [];
  if (ids.length === 0) return;

  const current = selectedId.value === undefined ? -1 : ids.indexOf(selectedId.value);
  // With nothing selected, `j` enters at the top of the queue and `k` at the bottom.
  const next =
    current === -1
      ? offset > 0
        ? 0
        : ids.length - 1
      : Math.min(Math.max(current + offset, 0), ids.length - 1);

  selectedId.value = ids[next];
}

// The sheet under `?` lists these; keep the two in step when either changes.
useHotkeys([
  { hotkey: 'J', callback: () => moveSelection(1) },
  { hotkey: 'K', callback: () => moveSelection(-1) },
  { hotkey: 'R', callback: refreshDashboard },
  {
    hotkey: '/',
    callback: () => taskTable.value?.focusFilter(),
    // Otherwise the slash lands in the field it just focused.
    options: { preventDefault: true },
  },
]);
</script>
