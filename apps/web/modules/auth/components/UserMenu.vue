<template>
  <div v-if="ready && loggedIn" class="border-t border-line p-4">
    <p class="m-0 label-upper">
      {{ $t('auth.session.signedInAs') }}
    </p>
    <p class="m-0 mt-1 truncate text-xs font-650" :title="user?.email">
      {{ user?.name || user?.email }}
    </p>
    <button
      class="focus-ring mt-2.5 h-8 w-full border border-line bg-raised text-xs text-ink font-650 transition hover:border-muted"
      type="button"
      @click="signOut()"
    >
      {{ $t('auth.session.signOut') }}
    </button>
  </div>
</template>

<script setup lang="ts">
const { user, loggedIn, ready, signOut } = useUserSession();
</script>
