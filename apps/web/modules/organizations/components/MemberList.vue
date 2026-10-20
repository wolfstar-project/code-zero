<template>
  <section>
    <h2 class="m-0 text-sm text-ink font-650">
      {{ $t('organizations.members.title') }}
    </h2>

    <p v-if="members.length === 0" class="m-0 mt-2 text-xs text-muted">
      {{ $t('organizations.members.empty') }}
    </p>

    <table v-else class="mt-3 w-full border-collapse text-left text-xs">
      <thead>
        <tr class="border-b border-line">
          <th scope="col" class="py-2 label-upper">{{ $t('organizations.members.name') }}</th>
          <th scope="col" class="py-2 label-upper">{{ $t('organizations.members.email') }}</th>
          <th scope="col" class="py-2 label-upper">{{ $t('organizations.members.role') }}</th>
          <th scope="col" class="py-2">
            <span class="sr-only">{{ $t('organizations.members.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="member in members" :key="member.id" class="border-b border-line">
          <td class="py-2 text-ink">{{ member.user.name }}</td>
          <td class="py-2 text-muted">{{ member.user.email }}</td>
          <td class="py-2 text-muted">{{ member.role }}</td>
          <td class="py-2 text-right">
            <button
              class="focus-ring h-7 border border-line bg-raised px-2 text-xs text-ink transition hover:border-muted"
              type="button"
              :disabled="pending"
              @click="removeMember(member.id)"
            >
              {{ $t('organizations.members.remove') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
const { members, pending, removeMember, refreshMembers } = useOrganizations();

onMounted(() => {
  void refreshMembers();
});
</script>
