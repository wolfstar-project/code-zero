import type { OrganizationSettingsView } from '@code-zero/api';
import type { ExecutionSettings } from '@code-zero/config';
import { ref } from 'vue';

import {
  organizationFieldIssues,
  organizationFormFromView,
  organizationInputFromForm,
  type OrganizationLimitsInput,
} from '../utils/form';
import { useSettingsForm } from './useSettingsForm';

/** `$orpc.settings.organization.update` from the page that owns the client. */
export type OrganizationLimitsSaver = (request: {
  organizationId: string;
  limits: OrganizationLimitsInput;
}) => Promise<OrganizationSettingsView>;

/**
 * One organization's own limits on the managed cloud, for an owner or admin.
 *
 * The plan is the ceiling: the server refuses any value above it, and the issue it reports is
 * shown beside the field. Emptying a field hands that limit back to the plan.
 */
export function useOrganizationLimitsForm(
  view: () => OrganizationSettingsView,
  plan: () => ExecutionSettings | null,
  save: OrganizationLimitsSaver,
  onSaved: (next: OrganizationSettingsView) => void,
) {
  return useSettingsForm({
    form: ref(organizationFormFromView(view(), plan())),
    initial: () => organizationFormFromView(view(), plan()),
    build: organizationInputFromForm,
    fieldIssues: organizationFieldIssues,
    save: (limits: OrganizationLimitsInput) => save({ organizationId: view().id, limits }),
    onSaved,
  });
}
