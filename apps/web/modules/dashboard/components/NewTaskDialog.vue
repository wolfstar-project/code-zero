<template>
  <!--
    A native modal `dialog` rather than an overlay built here: `showModal()` already traps focus,
    makes the page behind it inert, closes on Escape and hands focus back to the button that opened
    it, so none of that is reimplemented.
  -->
  <dialog
    ref="dialog"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto border border-line bg-panel p-0 text-ink backdrop:bg-canvas/70 backdrop:backdrop-blur-sm"
    :aria-labelledby="titleId"
    @close="open = false"
    @click.self="open = false"
  >
    <div class="section-title">
      <h2 :id="titleId" class="m-0 text-xs font-750 tracking-[0.12em] uppercase">
        {{ $t('dashboard.newTask.title') }}
      </h2>
      <button
        class="btn-icon h-8 w-8 border-transparent bg-transparent text-muted hover:text-ink"
        type="button"
        :aria-label="$t('common.actions.close')"
        @click="open = false"
      >
        <Icon aria-hidden="true" class="h-4 w-4" name="lucide:x" />
      </button>
    </div>

    <!-- Mounted per opening, so closing discards the draft: the alternative is a form that quietly
         keeps a repository path from earlier and submits it against whatever is typed next. -->
    <NewTaskForm v-if="open" :pending="pending" :error="error" @submit="emit('submit', $event)" />
  </dialog>
</template>

<script setup lang="ts">
import type { NewTaskRequest } from './NewTaskForm.vue';

defineProps<{ pending?: boolean; error?: string }>();

const emit = defineEmits<{ submit: [request: NewTaskRequest] }>();

const open = defineModel<boolean>('open', { default: false });

const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const titleId = useId();

watch(open, (isOpen) => {
  const element = dialog.value;
  if (!element) return;
  if (isOpen && !element.open) element.showModal();
  else if (!isOpen && element.open) element.close();
});
</script>
