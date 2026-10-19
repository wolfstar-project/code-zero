<template>
  <!-- `novalidate`: the inputs carry the bounds as hints, but the server's parser is the judge, and
       a value it refuses comes back beside the field it belongs to. -->
  <form class="panel" novalidate :aria-busy="saving" @submit.prevent="submit">
    <h2 class="section-title m-0 text-xs">{{ $t('dashboard.settings.sections.execution') }}</h2>
    <div class="grid gap-4 p-4 md:grid-cols-2">
      <SettingsField
        v-slot="{ id, describedBy, invalid }"
        :label="$t('dashboard.settings.fields.maxConcurrentTasks')"
        :hint="
          $t('dashboard.settings.hints.maxConcurrentTasks', {
            min: bounds.maxConcurrentTasks.minimum,
            max: bounds.maxConcurrentTasks.maximum,
          })
        "
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
          :max="bounds.maxConcurrentTasks.maximum"
          :disabled="saving"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedBy"
          name="maxConcurrentTasks"
        />
      </SettingsField>

      <SettingsField
        v-slot="{ id, describedBy, invalid }"
        :label="$t('dashboard.settings.fields.commandTimeoutMinutes')"
        :hint="
          $t('dashboard.settings.hints.commandTimeoutMinutes', {
            min: bounds.commandTimeoutMinutes.minimum,
            max: bounds.commandTimeoutMinutes.maximum,
          })
        "
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
          :max="bounds.commandTimeoutMinutes.maximum"
          :disabled="saving"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedBy"
          name="commandTimeoutMinutes"
        />
      </SettingsField>

      <SettingsField
        v-slot="{ describedBy }"
        group
        :label="$t('dashboard.settings.fields.allowedModes')"
        :hint="$t('dashboard.settings.hints.allowedModes')"
        :issues="issues.allowedModes"
      >
        <div class="flex flex-wrap gap-x-4 gap-y-2" :aria-describedby="describedBy">
          <label
            v-for="mode in RUN_MODES"
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

      <SettingsField
        v-slot="{ id, describedBy, invalid }"
        :label="$t('dashboard.settings.fields.maxNetwork')"
        :hint="$t('dashboard.settings.hints.maxNetwork')"
        :issues="issues.maxNetwork"
      >
        <select
          :id="id"
          v-model="form.maxNetwork"
          class="input-field w-full"
          :disabled="saving"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedBy"
          name="maxNetwork"
        >
          <option v-for="policy in NETWORK_POLICIES" :key="policy" :value="policy">
            {{ $t(NETWORK_LABEL_KEYS[policy]) }}
          </option>
        </select>
      </SettingsField>
    </div>

    <h2 class="section-title m-0 border-t border-line text-xs">
      {{ $t('dashboard.settings.sections.model') }}
    </h2>
    <div class="grid gap-4 p-4 md:grid-cols-2">
      <SettingsField
        class="md:col-span-2"
        group
        :label="$t('dashboard.settings.fields.modelSource')"
        :hint="$t('dashboard.settings.hints.model')"
        :issues="issues.modelSource"
      >
        <div class="flex flex-col gap-1 sm:flex-row sm:gap-5">
          <label class="h-9 inline-flex cursor-pointer items-center gap-2 text-xs text-ink">
            <input
              v-model="form.modelSource"
              class="focus-ring h-4 w-4 accent-accent"
              type="radio"
              name="modelSource"
              value="repository"
              :disabled="saving"
            />
            {{ $t('dashboard.settings.choices.modelRepository') }}
          </label>
          <label class="h-9 inline-flex cursor-pointer items-center gap-2 text-xs text-ink">
            <input
              v-model="form.modelSource"
              class="focus-ring h-4 w-4 accent-accent"
              type="radio"
              name="modelSource"
              value="deployment"
              :disabled="saving"
            />
            {{ $t('dashboard.settings.choices.modelDeployment') }}
          </label>
        </div>
      </SettingsField>

      <template v-if="form.modelSource === 'deployment'">
        <SettingsField
          v-slot="{ id, describedBy, invalid }"
          :label="$t('dashboard.settings.fields.provider')"
          :issues="issues.modelProvider"
        >
          <select
            :id="id"
            v-model="form.modelProvider"
            class="input-field w-full mono"
            :disabled="saving"
            :aria-invalid="invalid || undefined"
            :aria-describedby="describedBy"
            name="modelProvider"
          >
            <option v-for="provider in MODEL_PROVIDERS" :key="provider" :value="provider">
              {{ provider }}
            </option>
          </select>
        </SettingsField>

        <SettingsField
          v-slot="{ id, describedBy, invalid }"
          :label="$t('dashboard.settings.fields.modelName')"
          :issues="issues.modelName"
        >
          <input
            :id="id"
            v-model="form.modelName"
            class="input-field w-full mono"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="$t('dashboard.settings.placeholders.modelName')"
            :disabled="saving"
            :aria-invalid="invalid || undefined"
            :aria-describedby="describedBy"
            name="modelName"
          />
        </SettingsField>
      </template>
    </div>

    <h2 class="section-title m-0 border-t border-line text-xs">
      {{ $t('dashboard.settings.sections.runner') }}
    </h2>
    <div class="grid gap-4 p-4 md:grid-cols-2">
      <SettingsField
        class="md:col-span-2"
        group
        :label="$t('dashboard.settings.fields.runnerSource')"
        :hint="$t('dashboard.settings.hints.runner')"
        :issues="issues.runnerSource"
      >
        <div class="flex flex-col gap-1 sm:flex-row sm:gap-5">
          <label class="h-9 inline-flex cursor-pointer items-center gap-2 text-xs text-ink">
            <input
              v-model="form.runnerSource"
              class="focus-ring h-4 w-4 accent-accent"
              type="radio"
              name="runnerSource"
              value="repository"
              :disabled="saving"
            />
            {{ $t('dashboard.settings.choices.runnerRepository') }}
          </label>
          <label class="h-9 inline-flex cursor-pointer items-center gap-2 text-xs text-ink">
            <input
              v-model="form.runnerSource"
              class="focus-ring h-4 w-4 accent-accent"
              type="radio"
              name="runnerSource"
              value="container"
              :disabled="saving"
            />
            {{ $t('dashboard.settings.choices.runnerContainer') }}
          </label>
        </div>
      </SettingsField>

      <template v-if="form.runnerSource === 'container'">
        <SettingsField
          v-slot="{ id, describedBy, invalid }"
          :label="$t('dashboard.settings.fields.engine')"
          :issues="issues.runnerEngine"
        >
          <select
            :id="id"
            v-model="form.runnerEngine"
            class="input-field w-full mono"
            :disabled="saving"
            :aria-invalid="invalid || undefined"
            :aria-describedby="describedBy"
            name="runnerEngine"
          >
            <option v-for="engine in CONTAINER_ENGINES" :key="engine" :value="engine">
              {{ engine }}
            </option>
          </select>
        </SettingsField>

        <SettingsField
          v-slot="{ id, describedBy, invalid }"
          :label="$t('dashboard.settings.fields.image')"
          :issues="issues.runnerImage"
        >
          <input
            :id="id"
            v-model="form.runnerImage"
            class="input-field w-full mono"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="$t('dashboard.settings.placeholders.image')"
            :disabled="saving"
            :aria-invalid="invalid || undefined"
            :aria-describedby="describedBy"
            name="runnerImage"
          />
        </SettingsField>
      </template>
    </div>

    <SettingsSaveBar
      :error="error"
      :form-issues="issues.form"
      :saved="saved"
      :saving="saving"
      :dirty="dirty"
      :save-label="$t('dashboard.settings.form.save')"
      @reset="reset"
    />
  </form>
</template>

<script setup lang="ts">
import type { SettingsView } from '@code-zero/api';

import type { SettingsSaver } from '../composables/useDeploymentSettingsForm';
import {
  CONTAINER_ENGINES,
  isRequiredMode,
  MODEL_PROVIDERS,
  NETWORK_POLICIES,
  RUN_MODES,
  type SelfHostedSettingsView,
} from '../utils/form';
import { MODE_LABEL_KEYS, NETWORK_LABEL_KEYS } from '../utils/labels';

const props = defineProps<{ view: SelfHostedSettingsView; save: SettingsSaver }>();
const emit = defineEmits<{ saved: [view: SettingsView] }>();

const bounds = computed(() => props.view.bounds);

const { form, issues, error, dirty, saving, saved, submit, reset } = useDeploymentSettingsForm(
  () => props.view,
  (input) => props.save(input),
  (next) => emit('saved', next),
);
</script>
