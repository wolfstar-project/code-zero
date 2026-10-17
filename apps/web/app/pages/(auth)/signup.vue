<template>
  <section class="panel w-full max-w-88 p-6">
    <h1 class="m-0 text-lg font-650 tracking-tight">{{ $t('auth.signup.title') }}</h1>
    <p class="mb-6 mt-1 text-xs text-muted">{{ $t('auth.login.subtitle') }}</p>

    <template v-if="canSignUp">
      <form class="flex flex-col gap-3" @submit.prevent="onSubmit">
        <label class="flex flex-col gap-1.5">
          <span class="label-upper">
            {{ $t('auth.login.name') }}
          </span>
          <input v-model="name" class="input-field" autocomplete="name" required type="text" />
        </label>

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
            autocomplete="new-password"
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
          {{ isPending ? $t('auth.signup.submitPending') : $t('auth.signup.submit') }}
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
    </template>

    <p v-else class="m-0 mt-4 text-xs text-muted">{{ $t('auth.signup.closed') }}</p>

    <NuxtLink class="btn-link mt-5 block w-full text-center" to="/login">
      {{ $t('auth.signup.toSignIn') }}
    </NuxtLink>
  </section>
</template>

<script setup lang="ts">
/**
 * Registration lives on its own route rather than behind a toggle on the sign-in page, so the two
 * flows have distinct URLs to link to, bookmark, and gate.
 *
 * `enableSignup` only decides what this page offers. The server enforces the same policy on its own
 * from the same environment, independent of this page, so the closed state below is presentation,
 * not the actual gate.
 */
definePageMeta({ layout: 'auth' });

const appConfig = useAppConfig();
const { localizeAuthError } = useAuthErrorMessage();

const signUpEmail = useSignUp('email');
const signInSocial = useSignIn('social');

const canSignUp = appConfig.auth.enableSignup;
const canUseGithub = appConfig.auth.enableGithubOauth;

const email = ref('');
const password = ref('');
const name = ref('');

const isPending = computed(
  () => signUpEmail.status.value === 'pending' || signInSocial.status.value === 'pending',
);
const errorMessage = computed(() => {
  const error = signUpEmail.error.value ?? signInSocial.error.value;
  return error ? localizeAuthError(error) : undefined;
});

async function onSubmit(): Promise<void> {
  await signUpEmail.execute({ email: email.value, password: password.value, name: name.value });
}

async function onGithub(): Promise<void> {
  await signInSocial.execute({ provider: 'github' });
}
</script>
