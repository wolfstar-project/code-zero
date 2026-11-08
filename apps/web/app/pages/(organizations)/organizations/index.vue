<template>
  <AppNavbar :title="$t('organizations.title')" />

  <div class="mx-auto max-w-4xl w-full p-4 sm:p-6">
    <p class="m-0 text-xs text-muted">{{ $t('organizations.subtitle') }}</p>

    <p v-if="error" class="m-0 mt-4 border border-line bg-raised p-3 text-xs text-ink" role="alert">
      {{ $t(error) }}
    </p>

    <template v-if="activeOrganization">
      <div class="mt-8">
        <OrganizationsMemberList />
      </div>
      <!-- Organization invitations travel through enrollment invites, so the form is offered only
           where the deployment serves them; the server refuses them everywhere else regardless. -->
      <div v-if="capabilities.organizationInvitations" class="mt-8">
        <OrganizationsInviteForm />
      </div>
    </template>

    <p v-else class="m-0 mt-8 text-xs text-muted">
      {{ $t('organizations.noneSelected') }}
    </p>
  </div>
</template>

<script setup lang="ts">
const { activeOrganization, error, refresh } = useOrganizations();
const capabilities = await useAuthCapabilities();

onMounted(() => {
  void refresh();
});
</script>
