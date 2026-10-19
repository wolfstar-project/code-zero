import { computed, shallowRef, watch, type Ref } from 'vue';

import {
  classifySettingsError,
  issuesFromError,
  type FieldIssues,
  type FormResult,
  type ServerIssue,
  type SettingsError,
} from '../utils/form';

/** Where a save stands. `saved` is only reported while the form still matches what was saved. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SettingsFormOptions<Form, Input, Field extends string, Result> {
  /**
   * The draft, created by the caller with `ref`, so its type is the caller's concrete form rather
   * than this function's generic one, and every control bound to it is deeply reactive.
   */
  form: Ref<Form>;
  /** The form the current server state fills in; read again whenever that state changes. */
  initial: () => Form;
  /** The input the form describes, or the fields that cannot be sent at all. */
  build: (form: Form) => FormResult<Input, Field>;
  /** Server issues by the control each one belongs to. */
  fieldIssues: (issues: readonly ServerIssue[]) => FieldIssues<Field>;
  save: (input: Input) => Promise<Result>;
  /** Receives what the server stored, so the page shows its answer rather than the draft. */
  onSaved: (result: Result) => void;
}

/**
 * A settings form: a draft, the server's verdict on it, and nothing decided in between.
 *
 * The draft starts from the server's state and starts over whenever that state changes, so a
 * refresh or a save never leaves a form describing settings that are no longer there. Issues come
 * back per field from the same parser the deployment file goes through; the form never decides a
 * value is acceptable on its own, it only declines to send one it cannot express.
 */
export function useSettingsForm<Form, Input, Field extends string, Result>(
  options: SettingsFormOptions<Form, Input, Field, Result>,
) {
  const { form } = options;
  const baseline = shallowRef(snapshot(form.value));
  const issues = shallowRef<FieldIssues<Field>>({});
  const status = shallowRef<SaveStatus>('idle');
  const error = shallowRef<SettingsError | null>(null);

  watch(options.initial, (next) => {
    form.value = next;
    baseline.value = snapshot(next);
    issues.value = {};
  });

  const dirty = computed(() => snapshot(form.value) !== baseline.value);
  const saving = computed(() => status.value === 'saving');
  const saved = computed(() => status.value === 'saved' && !dirty.value);

  async function submit(): Promise<void> {
    if (saving.value) return;
    const built = options.build(form.value);
    if (!built.ok) {
      issues.value = built.issues;
      status.value = 'error';
      error.value = 'invalid';
      return;
    }
    status.value = 'saving';
    issues.value = {};
    error.value = null;
    try {
      const result = await options.save(built.input);
      status.value = 'saved';
      options.onSaved(result);
    } catch (caught) {
      const server = issuesFromError(caught);
      issues.value = server ? options.fieldIssues(server) : {};
      error.value = classifySettingsError(caught);
      status.value = 'error';
    }
  }

  /** Discards the draft and its issues, back to what the server holds. */
  function reset(): void {
    form.value = options.initial();
    baseline.value = snapshot(form.value);
    issues.value = {};
    error.value = null;
    status.value = 'idle';
  }

  return { form, issues, status, error, dirty, saving, saved, submit, reset };
}

function snapshot(value: unknown): string {
  return JSON.stringify(value);
}
