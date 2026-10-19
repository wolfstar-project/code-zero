import type { SettingsView } from '@code-zero/api';
import { ref } from 'vue';

import {
  formFromView,
  settingsFieldIssues,
  settingsInputFromForm,
  type SelfHostedSettingsView,
  type SettingsInput,
} from '../utils/form';
import { useSettingsForm } from './useSettingsForm';

/** `$orpc.settings.update` from the page that owns the client. */
export type SettingsSaver = (input: SettingsInput) => Promise<SettingsView>;

/**
 * The deployment settings form, for a self-hosted deployment whose source is the dashboard.
 *
 * Offered only where the view says the settings are `editable`; the server refuses the save
 * anywhere else regardless, so a page that rendered this by mistake could still change nothing.
 */
export function useDeploymentSettingsForm(
  view: () => SelfHostedSettingsView,
  save: SettingsSaver,
  onSaved: (next: SettingsView) => void,
) {
  return useSettingsForm({
    form: ref(formFromView(view())),
    initial: () => formFromView(view()),
    build: settingsInputFromForm,
    fieldIssues: settingsFieldIssues,
    save,
    onSaved,
  });
}
