<template>
  <section class="panel w-full max-w-88 p-6">
    <h1 class="m-0 text-lg font-650 tracking-tight">{{ $t('auth.invite.title') }}</h1>
    <p v-if="organizationName" class="mb-6 mt-1 text-xs text-muted">{{ organizationName }}</p>

    <p v-if="stage === 'loading'" class="m-0 mt-4 text-xs text-muted">
      {{ $t('auth.invite.loading') }}
    </p>

    <template v-else-if="stage === 'accepted'">
      <p class="m-0 mt-4 text-xs text-muted">
        {{ signedIn ? $t('auth.invite.acceptedSignedIn') : $t('auth.invite.accepted') }}
      </p>
      <NuxtLink class="btn-subtle mt-4 w-full" :to="signedIn ? '/' : '/login'">
        {{ signedIn ? $t('auth.invite.continue') : $t('auth.invite.signIn') }}
      </NuxtLink>
    </template>

    <form
      v-else-if="stage === 'SIGN_UP'"
      class="mt-4 flex flex-col gap-3"
      @submit.prevent="onSubmit"
    >
      <label v-if="needs('email')" class="flex flex-col gap-1.5">
        <span class="label-upper">{{ $t('auth.login.email') }}</span>
        <input v-model="email" class="input-field" autocomplete="email" required type="email" />
      </label>

      <label v-if="needs('name')" class="flex flex-col gap-1.5">
        <span class="label-upper">{{ $t('auth.login.name') }}</span>
        <input v-model="name" class="input-field" autocomplete="name" required type="text" />
      </label>

      <label v-if="needs('password')" class="flex flex-col gap-1.5">
        <span class="label-upper">{{ $t('auth.login.password') }}</span>
        <input
          v-model="password"
          class="input-field"
          autocomplete="new-password"
          required
          type="password"
        />
      </label>

      <label v-if="needs('organizationName')" class="flex flex-col gap-1.5">
        <span class="label-upper">{{ $t('auth.invite.organizationName') }}</span>
        <input v-model="organizationNameInput" class="input-field" required type="text" />
      </label>

      <label v-if="needs('organizationSlug')" class="flex flex-col gap-1.5">
        <span class="label-upper">{{ $t('auth.invite.organizationSlug') }}</span>
        <input v-model="organizationSlug" class="input-field" required type="text" />
      </label>

      <p
        v-if="errorMessage"
        class="m-0 border border-danger/35 bg-danger/8 p-2.5 text-xs text-danger"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <button class="btn-accent" :disabled="isPending" type="submit">
        {{ isPending ? $t('auth.invite.submitPending') : $t('auth.invite.submit') }}
      </button>
    </form>

    <template v-else-if="stage === 'CONFIRM'">
      <p class="m-0 mt-4 text-xs text-muted">{{ $t('auth.invite.confirmPrompt') }}</p>

      <p
        v-if="errorMessage"
        class="m-0 mt-3 border border-danger/35 bg-danger/8 p-2.5 text-xs text-danger"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <button class="btn-accent mt-4 w-full" :disabled="isPending" type="button" @click="onSubmit">
        {{ isPending ? $t('auth.invite.confirmPending') : $t('auth.invite.confirm') }}
      </button>
    </template>

    <template v-else-if="stage === 'SIGN_IN'">
      <p class="m-0 mt-4 text-xs text-muted">{{ $t('auth.invite.signInPrompt') }}</p>
      <NuxtLink class="btn-subtle mt-4 w-full" :to="signInLink">
        {{ $t('auth.invite.signIn') }}
      </NuxtLink>
    </template>

    <template v-else>
      <p class="m-0 mt-4 text-xs text-ink" role="alert">
        {{ stage === 'missingToken' ? $t('auth.invite.missingToken') : invalidMessage }}
      </p>
      <NuxtLink class="btn-subtle mt-4 w-full" to="/login">
        {{ $t('auth.invite.signIn') }}
      </NuxtLink>
    </template>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * The single redemption page every invitation link points at.
 *
 * It carries only `?token=`, and what to render is decided by the auth server's `nextAction`
 * rather than by anything encoded in the URL, so one page covers private and public invitations,
 * app and organization invitations, and both invite-only and open deployments.
 *
 * Deliberately has no route rule: requiring a session would reject the signed-out invitee this
 * page exists for, and requiring a guest would reject the signed-in one accepting an organization
 * invitation. Both arrive here legitimately.
 */
definePageMeta({ layout: 'auth' });

const route = useRoute();
const { localizeAuthError } = useAuthErrorMessage();
const i18n = useI18n();

/**
 * Where "sign in to accept" sends a signed-out invitee in open mode.
 *
 * `@onmax/nuxt-better-auth` reads this same query param off the login page's own URL and, when
 * `signInEmail`/`signInSocial` complete without an explicit `onSuccess` (which `login.vue` does
 * not pass), navigates there automatically. Without it, sign-in would land on `/` and the token
 * would never reach `invite.redeem`, silently dropping the invitation.
 */
const authRuntimeConfig = useRuntimeConfig().public.auth;
const signInLink = computed(() => ({
  path: '/login',
  query: { [authRuntimeConfig?.redirectQueryKey ?? 'redirect']: route.fullPath },
}));

/** What the page is currently showing. Mirrors `nextAction`, plus the states it has no value for. */
type Stage =
  | 'loading'
  | 'SIGN_UP'
  | 'SIGN_IN'
  | 'CONFIRM'
  | 'accepted'
  | 'invalid'
  | 'missingToken';

const stage = ref<Stage>('loading');
const requiredFields = ref<readonly string[]>([]);
const organizationName = ref<string | null>(null);
const signedIn = ref(false);
const isPending = ref(false);
const errorMessage = ref<string | undefined>();
const invalidMessage = ref(i18n.t('auth.invite.invalid'));

const email = ref('');
const name = ref('');
const password = ref('');
const organizationNameInput = ref('');
const organizationSlug = ref('');

const token = computed(() => {
  const value = route.query.token;
  return typeof value === 'string' ? value : '';
});

function needs(field: string): boolean {
  return requiredFields.value.includes(field);
}

/**
 * The token arrives from an email link, so it is untrusted input: it is passed straight to the
 * auth server, which owns every decision about it, and is never used to build a redirect target.
 *
 * `useAuthClient()` is called here rather than at setup scope: it resolves to `null` during SSR
 * and stays the value captured at setup for the rest of the component's life, so calling it at
 * setup scope would permanently pin `client` to `null` even after hydration. `onMounted` only runs
 * client-side, once hydration has completed, so the client is available every time this runs.
 */
onMounted(async () => {
  if (!token.value) {
    stage.value = 'missingToken';
    return;
  }

  const client = useAuthClient();
  if (!client) {
    stage.value = 'invalid';
    return;
  }

  // Better Auth resolves API failures as `{ data, error }` rather than rejecting, so a consumed or
  // expired invitation has to be read from the resolved error as well as from the catch path.
  try {
    const { data, error } = await client.invite.get({ query: { token: token.value } });
    if (error || !data) {
      invalidMessage.value = localizeAuthError(error, 'auth.invite.invalid');
      stage.value = 'invalid';
      return;
    }

    requiredFields.value = data.requiredFields ?? [];
    organizationName.value = data.organizationName ?? null;
    // A null `nextAction` is the server saying the invitation is expired, revoked, or consumed.
    stage.value = data.nextAction ?? 'invalid';
  } catch {
    stage.value = 'invalid';
  }
});

/**
 * Redeem the invitation.
 *
 * Only the fields the server asked for are sent. Redemption deliberately does not start a session,
 * so a new account is handed to the sign-in page with the credentials it just set rather than
 * being signed in here: for a private invitation this page never learns the full address to sign
 * in with, since `invite.get` returns it masked.
 */
async function onSubmit(): Promise<void> {
  if (isPending.value) return;

  isPending.value = true;
  errorMessage.value = undefined;
  // Captured before the request so the accepted state can tell "signed in already" apart from
  // "account just created", which decides where the visitor is sent next.
  const wasConfirm = stage.value === 'CONFIRM';

  try {
    const client = useAuthClient();
    if (!client) {
      errorMessage.value = localizeAuthError(undefined, 'auth.invite.invalid');
      return;
    }

    const { error } = await client.invite.redeem({
      token: token.value,
      ...(needs('email') ? { email: email.value } : {}),
      ...(needs('name') ? { name: name.value } : {}),
      ...(needs('password') ? { password: password.value } : {}),
      ...(needs('organizationName') ? { organizationName: organizationNameInput.value } : {}),
      ...(needs('organizationSlug') ? { organizationSlug: organizationSlug.value } : {}),
    });

    if (error) {
      errorMessage.value = localizeAuthError(error, 'auth.invite.invalid');
      return;
    }

    signedIn.value = wasConfirm;
    stage.value = 'accepted';
  } catch {
    errorMessage.value = localizeAuthError(undefined, 'auth.invite.invalid');
  } finally {
    isPending.value = false;
    password.value = '';
  }
}
</script>
