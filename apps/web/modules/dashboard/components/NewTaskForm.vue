<template>
  <!-- The fields only. `NewTaskDialog` decides when they are shown and mounts a fresh copy each
       time it opens, which is what discards an earlier draft. -->
  <form class="p-4" @submit.prevent="submit">
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="sm:col-span-2">
        <span class="label-upper">{{ $t('dashboard.newTask.repository') }}</span>
        <input
          v-model="repository"
          class="input-field mt-1.5 w-full font-mono max-md:h-11"
          :disabled="pending"
          :placeholder="$t('dashboard.newTask.repositoryHint')"
          required
          type="text"
        />
      </label>

      <label>
        <span class="label-upper">{{ $t('dashboard.newTask.mode') }}</span>
        <select v-model="mode" class="input-field mt-1.5 w-full max-md:h-11" :disabled="pending">
          <option v-for="option in MODES" :key="option" :value="option">
            {{ $t(`dashboard.newTask.modes.${option}`) }}
          </option>
        </select>
      </label>

      <label>
        <span class="label-upper">{{ $t('dashboard.newTask.trigger') }}</span>
        <select v-model="trigger" class="input-field mt-1.5 w-full max-md:h-11" :disabled="pending">
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
        class="focus-ring mt-1.5 w-full border border-line bg-raised p-2.5 text-xs text-ink"
        :disabled="pending"
        required
        rows="3"
      />
    </label>

    <p v-if="error" class="mb-0 mt-3 text-xs text-danger" role="alert">{{ error }}</p>

    <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
      <button class="btn-primary shrink-0 px-4 max-md:h-11" type="submit" :disabled="pending">
        {{ $t('dashboard.newTask.submit') }}
      </button>
      <p class="m-0 text-xs text-muted">{{ $t('dashboard.newTask.note') }}</p>
    </div>
  </form>
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
</script>
