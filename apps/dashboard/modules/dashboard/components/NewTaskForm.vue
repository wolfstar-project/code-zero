<template>
  <!--
    `details` rather than a dialog with its own open state: the form is a secondary action on a
    monitoring page, and the element already handles toggling, keyboard, and screen-reader
    semantics without any of it being reimplemented here.
  -->
  <details ref="root" class="panel" @toggle="onToggle">
    <summary
      class="h-11 flex cursor-pointer list-none items-center gap-2 px-4 text-xs font-650 marker:hidden"
    >
      <Icon aria-hidden="true" class="h-3.5 w-3.5 text-muted" name="lucide:plus" />
      {{ $t('dashboard.newTask.title') }}
    </summary>

    <form class="border-t border-line p-4" @submit.prevent="submit">
      <div class="grid gap-3 md:grid-cols-3">
        <label class="md:col-span-3">
          <span class="label-upper">{{ $t('dashboard.newTask.repository') }}</span>
          <input
            v-model="repository"
            class="mt-1.5 h-9 w-full border border-line bg-canvas px-2 font-mono text-xs text-ink"
            :disabled="pending"
            :placeholder="$t('dashboard.newTask.repositoryHint')"
            required
            type="text"
          />
        </label>

        <label>
          <span class="label-upper">{{ $t('dashboard.newTask.mode') }}</span>
          <select
            v-model="mode"
            class="mt-1.5 h-9 w-full border border-line bg-canvas px-2 text-xs text-ink"
            :disabled="pending"
          >
            <option v-for="option in MODES" :key="option" :value="option">
              {{ $t(`dashboard.newTask.modes.${option}`) }}
            </option>
          </select>
        </label>

        <label>
          <span class="label-upper">{{ $t('dashboard.newTask.trigger') }}</span>
          <select
            v-model="trigger"
            class="mt-1.5 h-9 w-full border border-line bg-canvas px-2 text-xs text-ink"
            :disabled="pending"
          >
            <option v-for="option in TRIGGERS" :key="option" :value="option">
              {{ $t(`dashboard.newTask.triggers.${option}`) }}
            </option>
          </select>
        </label>
      </div>

      <label v-if="trigger === 'feedback'" class="mt-3 block">
        <span class="label-upper">{{ $t('dashboard.newTask.feedback') }}</span>
        <textarea
          v-model="feedback"
          class="mt-1.5 w-full border border-line bg-canvas p-2 text-xs text-ink"
          :disabled="pending"
          required
          rows="3"
        />
      </label>

      <p v-if="error" class="mb-0 mt-3 text-xs text-error">{{ error }}</p>

      <div class="mt-4 flex items-center gap-3">
        <button class="btn-primary px-3" type="submit" :disabled="pending">
          {{ $t('dashboard.newTask.submit') }}
        </button>
        <p class="m-0 text-xs text-muted">{{ $t('dashboard.newTask.note') }}</p>
      </div>
    </form>
  </details>
</template>

<script setup lang="ts">
/** Every mode the router will accept; which of them a principal may request is the server's call. */
const MODES = ['observe', 'suggest', 'fix', 'autonomous'] as const;
const TRIGGERS = ['proactive', 'feedback'] as const;

export interface NewTaskRequest {
  repository: string;
  mode: (typeof MODES)[number];
  trigger: (typeof TRIGGERS)[number];
  feedback?: string;
}

const props = defineProps<{ pending?: boolean; error?: string }>();

/** Submitted rather than sent from here, for the reason `TaskInspector` emits its decision. */
const emit = defineEmits<{ submit: [request: NewTaskRequest] }>();

const root = useTemplateRef<HTMLDetailsElement>('root');
const repository = ref('');
const mode = ref<(typeof MODES)[number]>('observe');
const trigger = ref<(typeof TRIGGERS)[number]>('proactive');
const feedback = ref('');

function submit(): void {
  if (props.pending) return;
  emit('submit', {
    repository: repository.value.trim(),
    mode: mode.value,
    trigger: trigger.value,
    ...(trigger.value === 'feedback' ? { feedback: feedback.value.trim() } : {}),
  });
}

/**
 * Closing discards the draft, opening starts from an empty one.
 *
 * The alternative is a form that quietly keeps a repository path from an earlier session and
 * submits it against whatever the operator typed next.
 */
function onToggle(): void {
  if (root.value?.open === true) {
    repository.value = '';
    feedback.value = '';
  }
}
</script>
