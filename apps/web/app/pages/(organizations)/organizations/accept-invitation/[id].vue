<template>
  <div class="mx-auto max-w-lg p-6">
    <h1 class="m-0 text-lg text-ink font-650">{{ $t('organizations.accept.title') }}</h1>

    <p v-if="status === 'pending'" class="m-0 mt-3 text-xs text-muted">
      {{ $t('organizations.accept.pending') }}
    </p>

    <p v-else-if="status === 'accepted'" class="m-0 mt-3 text-xs text-muted">
      {{ $t('organizations.accept.accepted') }}
    </p>

    <p v-else class="m-0 mt-3 text-xs text-ink" role="alert">
      {{ $t('organizations.accept.failed') }}
    </p>

    <NuxtLink
      v-if="status !== 'pending'"
      class="focus-ring mt-4 inline-flex h-8 items-center border border-line bg-raised px-3 text-xs text-ink font-650 transition hover:border-muted"
      to="/"
    >
      {{ $t('organizations.accept.continue') }}
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
const route = useRoute('organizations-accept-invitation-id');

const status = ref<'pending' | 'accepted' | 'failed'>('pending');

/**
 * The invitation id arrives from an email link, so it is untrusted input: it is passed straight to
 * the auth server, which owns the decision, and never used to build a redirect target here.
 *
 * `useAuthClient()` is called here rather than at setup scope: it resolves to `null` during SSR
 * and stays the value captured at setup for the rest of the component's life, so calling it at
 * setup scope would permanently pin `client` to `null` even after hydration. `onMounted` only runs
 * client-side, once hydration has completed, so the client is available every time this runs.
 */
onMounted(async () => {
  const invitationId = String(route.params.id ?? '');
  const client = useAuthClient();
  if (!invitationId || !client) {
    status.value = 'failed';
    return;
  }

  try {
    // Better Auth resolves API failures as `{ data, error }` rather than rejecting, so an invalid
    // or expired invitation must be read from the resolved error, not just the catch path.
    const { error } = await client.organization.acceptInvitation({ invitationId });
    status.value = error ? 'failed' : 'accepted';
  } catch {
    status.value = 'failed';
  }
});
</script>
