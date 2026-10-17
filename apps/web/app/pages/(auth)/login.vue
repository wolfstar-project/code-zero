<template>
  <section class="panel w-full max-w-88 p-6">
    <h1 class="m-0 text-lg font-650 tracking-tight">{{ $t('auth.login.title') }}</h1>
    <p class="mb-6 mt-1 text-xs text-muted">{{ $t('auth.login.subtitle') }}</p>

    <form class="flex flex-col gap-3" @submit.prevent="onSubmit">
      <label class="flex flex-col gap-1.5">
        <span class="label-upper">
          {{ $t('auth.login.email') }}
        </span>
        <input v-model="email" class="input-field" autocomplete="email" required type="email" />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="label-upper">
          {{ $t('auth.login.password') }}
        </span>
        <input
          v-model="password"
          class="input-field"
          autocomplete="current-password"
          required
          type="password"
        />
      </label>

      <p
        v-if="errorMessage"
        class="m-0 border border-danger/35 bg-danger/8 p-2.5 text-xs text-danger"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <button class="btn-accent" :disabled="isPending" type="submit">
        {{ isPending ? $t('auth.login.submitPending') : $t('auth.login.submit') }}
      </button>
    </form>

    <template v-if="canUseGithub">
      <p class="my-4 text-center label-upper">
        {{ $t('auth.login.separator') }}
      </p>
      <button class="btn-subtle w-full" :disabled="isPending" type="button" @click="onGithub">
        {{ $t('auth.login.github') }}
      </button>
    </template>

    <NuxtLink v-if="canSignUp" class="btn-link mt-5 block w-full text-center" to="/signup">
      {{ $t('auth.login.toSignUp') }}
    </NuxtLink>
  </section>
</template>

<script setup lang="ts">
/**
 * Sign-in only. Registration lives on `/signup`, which this page links to when the published
 * policy enables it; the link is hidden otherwise so a closed deployment offers no dead end.
 */
definePageMeta({ layout: 'auth' });

const appConfig = useAppConfig();
const { localizeAuthError } = useAuthErrorMessage();

const signInEmail = useSignIn('email');
const signInSocial = useSignIn('social');

const canSignUp = appConfig.auth.enableSignup;
const canUseGithub = appConfig.auth.enableGithubOauth;

const email = ref('');
const password = ref('');

const isPending = computed(
  () => signInEmail.status.value === 'pending' || signInSocial.status.value === 'pending',
);
const errorMessage = computed(() => {
  const error = signInEmail.error.value ?? signInSocial.error.value;
  return error ? localizeAuthError(error) : undefined;
});

async function onSubmit(): Promise<void> {
  await signInEmail.execute({ email: email.value, password: password.value });
}

async function onGithub(): Promise<void> {
  await signInSocial.execute({ provider: 'github' });
}
</script>
