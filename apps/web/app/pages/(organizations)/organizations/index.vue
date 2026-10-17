<template>
  <div class="mx-auto max-w-4xl p-6">
    <header>
      <h1 class="m-0 text-lg text-ink font-650">{{ $t('organizations.title') }}</h1>
      <p class="m-0 mt-1 text-xs text-muted">{{ $t('organizations.subtitle') }}</p>
    </header>

    <p v-if="error" class="m-0 mt-4 border border-line bg-raised p-3 text-xs text-ink" role="alert">
      {{ $t(error) }}
    </p>

    <template v-if="activeOrganization">
      <div class="mt-8">
        <OrganizationsMemberList />
      </div>
      <div class="mt-8">
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

onMounted(() => {
  void refresh();
});
</script>
