<template>
  <div v-if="organizations.length > 0" class="border-t border-line p-4">
    <label class="m-0 label-upper" :for="selectId">
      {{ $t('organizations.switcher.label') }}
    </label>
    <select
      :id="selectId"
      class="focus-ring mt-2 h-8 w-full border border-line bg-raised px-2 text-xs text-ink"
      :disabled="pending"
      :value="activeOrganization?.id ?? ''"
      @change="onChange"
    >
      <option v-for="organization in organizations" :key="organization.id" :value="organization.id">
        {{ organization.name }}
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
const { organizations, activeOrganization, pending, setActive, refresh } = useOrganizations();

const selectId = useId();

function onChange(event: Event) {
  const { value } = event.target as HTMLSelectElement;
  if (value) void setActive(value);
}

// The sidebar mounts once per session, so the list is fetched here rather than per page.
onMounted(() => {
  void refresh();
});
</script>
