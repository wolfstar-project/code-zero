<template>
  <section class="panel" :aria-labelledby="titleId">
    <div class="section-title">
      <h2 :id="titleId" class="m-0 text-xs font-650">
        {{ $t('dashboard.settings.organization.title') }}
      </h2>
      <span class="chip">
        <Icon aria-hidden="true" class="h-3 w-3" name="lucide:users" />
        {{ organization.role }}
      </span>
    </div>
    <p class="m-0 border-b border-line px-4 py-3 text-xs text-muted">
      {{ $t('dashboard.settings.organization.caption') }}
    </p>

    <p
      v-if="organization.invalid"
      class="m-0 flex items-start gap-2 border-b border-line px-4 py-3 text-xs text-danger"
      role="alert"
    >
      <Icon aria-hidden="true" class="mt-0.5 h-3.5 w-3.5 shrink-0" name="lucide:octagon-alert" />
      {{ $t('dashboard.settings.organization.invalid') }}
    </p>

    <form v-if="organization.editable" novalidate :aria-busy="saving" @submit.prevent="submit">
      <div class="grid gap-4 p-4 md:grid-cols-2">
        <SettingsField
          v-slot="{ id, describedBy, invalid }"
          :label="$t('dashboard.settings.fields.maxConcurrentTasks')"
          :hint="$t('dashboard.settings.organization.emptyUsesPlan')"
          :issues="issues.maxConcurrentTasks"
        >
          <input
            :id="id"
            v-model="form.maxConcurrentTasks"
            class="input-field w-full mono"
            type="number"
            inputmode="numeric"
            step="1"
            :min="bounds.maxConcurrentTasks.minimum"
            :max="plan?.maxConcurrentTasks ?? bounds.maxConcurrentTasks.maximum"
            :placeholder="planPlaceholder(plan?.maxConcurrentTasks)"
            :disabled="saving"
            :aria-invalid="invalid || undefined"
            :aria-describedby="describedBy"
            name="maxConcurrentTasks"
          />
        </SettingsField>

        <SettingsField
          v-slot="{ id, describedBy, invalid }"
          :label="$t('dashboard.settings.fields.commandTimeoutMinutes')"
          :hint="$t('dashboard.settings.organization.emptyUsesPlan')"
          :issues="issues.commandTimeoutMinutes"
        >
          <input
            :id="id"
            v-model="form.commandTimeoutMinutes"
            class="input-field w-full mono"
            type="number"
            inputmode="numeric"
            step="1"
            :min="bounds.commandTimeoutMinutes.minimum"
            :max="plan?.commandTimeoutMinutes ?? bounds.commandTimeoutMinutes.maximum"
            :placeholder="planPlaceholder(plan?.commandTimeoutMinutes)"
            :disabled="saving"
            :aria-invalid="invalid || undefined"
            :aria-describedby="describedBy"
            name="commandTimeoutMinutes"
          />
        </SettingsField>

        <SettingsField
          class="md:col-span-2"
          group
          :label="$t('dashboard.settings.fields.allowedModes')"
          :hint="$t('dashboard.settings.hints.allowedModes')"
          :issues="issues.allowedModes"
        >
          <label class="h-9 inline-flex cursor-pointer items-center gap-2 text-xs text-ink">
            <input
              v-model="form.restrictModes"
              class="focus-ring h-4 w-4 accent-accent"
              type="checkbox"
              name="restrictModes"
              :disabled="saving"
            />
            {{ $t('dashboard.settings.organization.restrictModes') }}
          </label>
          <div v-if="form.restrictModes" class="mt-1 flex flex-wrap gap-x-4 gap-y-2 ps-6">
            <label
              v-for="mode in modes"
              :key="mode"
              class="h-9 inline-flex cursor-pointer items-center gap-2 text-xs text-ink"
            >
              <input
                v-model="form.allowedModes"
                class="focus-ring h-4 w-4 accent-accent"
                type="checkbox"
                name="allowedModes"
                :value="mode"
                :disabled="saving || isRequiredMode(mode)"
              />
              {{ $t(MODE_LABEL_KEYS[mode]) }}
            </label>
          </div>
        </SettingsField>
      </div>

      <SettingsSaveBar
        :error="error"
        :form-issues="issues.form"
        :saved="saved"
        :saving="saving"
        :dirty="dirty"
        :save-label="$t('dashboard.settings.organization.save')"
        :saved-message="$t('dashboard.settings.organization.saved')"
        @reset="reset"
      />
    </form>

    <template v-else>
      <dl class="m-0 grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
        <div>
          <dt class="label-upper">{{ $t('dashboard.settings.fields.maxConcurrentTasks') }}</dt>
          <dd
            class="m-0 mt-1 text-ink"
            :class="organization.limits.maxConcurrentTasks === null ? 'text-xs' : 'mono'"
          >
            {{
              organization.limits.maxConcurrentTasks ??
              $t('dashboard.settings.organization.usesPlan')
            }}
          </dd>
        </div>
        <div>
          <dt class="label-upper">{{ $t('dashboard.settings.fields.commandTimeoutMinutes') }}</dt>
          <dd
            class="m-0 mt-1 text-ink"
            :class="organization.limits.commandTimeoutMinutes === null ? 'text-xs' : 'mono'"
          >
            {{
              organization.limits.commandTimeoutMinutes === null
                ? $t('dashboard.settings.organization.usesPlan')
                : $t('dashboard.settings.values.minutes', {
                    count: organization.limits.commandTimeoutMinutes,
                  })
            }}
          </dd>
        </div>
        <div class="sm:col-span-2">
          <dt class="label-upper">{{ $t('dashboard.settings.fields.allowedModes') }}</dt>
          <dd class="m-0 mt-1 flex flex-wrap gap-1.5">
            <template v-if="organization.limits.allowedModes">
              <span v-for="mode in organization.limits.allowedModes" :key="mode" class="chip">
                {{ $t(MODE_LABEL_KEYS[mode]) }}
              </span>
            </template>
            <span v-else class="text-xs text-ink">{{
              $t('dashboard.settings.organization.usesPlan')
            }}</span>
          </dd>
        </div>
      </dl>
      <p class="m-0 flex items-center gap-2 border-t border-line px-4 py-3 text-3xs text-muted">
        <Icon aria-hidden="true" class="h-3.5 w-3.5 shrink-0" name="lucide:lock" />
        {{ $t('dashboard.settings.organization.readOnly') }}
      </p>
    </template>

    <h3 class="section-title m-0 border-t border-line text-xs">
      {{ $t('dashboard.settings.organization.effective') }}
    </h3>
    <div class="p-4">
      <SettingsExecution v-if="organization.effective" :execution="organization.effective" />
      <p v-else class="m-0 text-xs text-muted">{{ $t('dashboard.settings.plan.unavailable') }}</p>
      <p class="m-0 mt-3 text-3xs text-muted">
        {{ $t('dashboard.settings.organization.effectiveCaption') }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { OrganizationSettingsView } from '@code-zero/api';
import type { ExecutionSettings } from '@code-zero/config';

import type { OrganizationLimitsSaver } from '../composables/useOrganizationLimitsForm';
import { isRequiredMode, selectableModes, type CloudSettingsView } from '../utils/form';
import { MODE_LABEL_KEYS } from '../utils/labels';

const props = defineProps<{
  organization: OrganizationSettingsView;
  plan: ExecutionSettings | null;
  bounds: CloudSettingsView['bounds'];
  save: OrganizationLimitsSaver;
}>();
const emit = defineEmits<{ saved: [organization: OrganizationSettingsView] }>();

const { t } = useI18n();
const titleId = useId();

/** Only the plan's modes are offered: an organization can narrow them, never add one. */
const modes = computed(() => selectableModes(props.plan));

const { form, issues, error, dirty, saving, saved, submit, reset } = useOrganizationLimitsForm(
  () => props.organization,
  () => props.plan,
  (request) => props.save(request),
  (next) => emit('saved', next),
);

function planPlaceholder(value: number | undefined): string {
  return value === undefined ? '' : t('dashboard.settings.organization.planValue', { value });
}
</script>
