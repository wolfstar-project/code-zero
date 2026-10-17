<template>
  <section>
    <h2 class="m-0 text-sm text-ink font-650">
      {{ $t('organizations.invite.title') }}
    </h2>

    <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="onSubmit">
      <div class="flex-1 min-w-48">
        <label class="m-0 label-upper" :for="emailId">
          {{ $t('organizations.invite.email') }}
        </label>
        <input
          :id="emailId"
          v-model="email"
          class="focus-ring mt-1 h-8 w-full border border-line bg-raised px-2 text-xs text-ink"
          type="email"
          required
          :disabled="pending"
        />
      </div>

      <div>
        <label class="m-0 label-upper" :for="roleId">
          {{ $t('organizations.invite.role') }}
        </label>
        <select
          :id="roleId"
          v-model="role"
          class="focus-ring mt-1 h-8 border border-line bg-raised px-2 text-xs text-ink"
          :disabled="pending"
        >
          <option v-for="option in roleOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>

      <button
        class="focus-ring h-8 border border-line bg-raised px-3 text-xs text-ink font-650 transition hover:border-muted"
        type="submit"
        :disabled="pending"
      >
        {{ pending ? $t('organizations.invite.submitPending') : $t('organizations.invite.submit') }}
      </button>
    </form>

    <p v-if="sent" class="m-0 mt-2 text-xs text-muted">
      {{ $t('organizations.invite.sent', { email: sent }) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { type OrganizationRole } from '../types/organization';

const { pending, inviteMember } = useOrganizations();
const { t } = useI18n();

const emailId = useId();
const roleId = useId();

// Written out as static `t()` calls rather than a dynamic `t(\`organizations.roles.${value}\`)`,
// since vue-i18n-extract's static usage report (`aube run i18n:report`) can't see interpolated
// keys and would otherwise report every role key as unused and fail the build.
const roleOptions = computed<{ value: OrganizationRole; label: string }[]>(() => [
  { value: 'member', label: t('organizations.roles.member') },
  { value: 'admin', label: t('organizations.roles.admin') },
  { value: 'owner', label: t('organizations.roles.owner') },
]);

const email = ref('');
const role = ref<OrganizationRole>('member');
const sent = ref('');

async function onSubmit() {
  const invited = await inviteMember({ email: email.value, role: role.value });
  // Only confirm once the server accepted it; the address is echoed back so the operator can spot
  // a typo before chasing a missing invitation.
  if (invited) {
    sent.value = email.value;
    email.value = '';
  }
}
</script>
