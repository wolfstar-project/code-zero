<template>
  <div v-if="ready && loggedIn" class="flex items-center gap-2.5 border-t border-line p-3">
    <span
      aria-hidden="true"
      class="h-8 w-8 shrink-0 grid place-items-center rounded-full border border-line bg-raised font-mono text-3xs text-ink font-700 uppercase"
    >
      {{ initials }}
    </span>
    <div class="min-w-0 flex-1">
      <span class="sr-only">{{ $t('auth.session.signedInAs') }}</span>
      <p class="m-0 truncate text-xs font-650" :title="user?.email">
        {{ user?.name || user?.email }}
      </p>
      <p v-if="user?.name" class="m-0 truncate text-3xs text-muted">{{ user.email }}</p>
    </div>
    <button
      class="btn-icon shrink-0 border-transparent bg-transparent text-muted hover:text-ink max-md:h-11 max-md:w-11"
      type="button"
      :aria-label="$t('auth.session.signOut')"
      :title="$t('auth.session.signOut')"
      @click="signOut()"
    >
      <Icon aria-hidden="true" class="h-4 w-4 rtl:scale-x-[-1]" name="lucide:log-out" />
    </button>
  </div>
</template>

<script setup lang="ts">
const WHITESPACE = /\s+/;

const { user, loggedIn, ready, signOut } = useUserSession();

/** Up to two letters for the avatar: the name's first two words, or the email's first letter. */
const initials = computed(() => {
  const name = user.value?.name?.trim();
  if (name) {
    return name
      .split(WHITESPACE)
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join('');
  }
  return user.value?.email?.charAt(0) ?? '';
});
</script>
