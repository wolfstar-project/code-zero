<template>
  <section class="w-full">
    <h1 class="m-0 text-lg font-650 tracking-tight">{{ $t('auth.twoFactor.title') }}</h1>
    <p class="mb-6 mt-1 text-xs text-muted">{{ subtitle }}</p>

    <form class="flex flex-col gap-3" @submit.prevent="onSubmit">
      <label class="flex flex-col gap-1.5">
        <span class="label-upper">
          {{ method === 'backup' ? $t('auth.twoFactor.backupCode') : $t('auth.twoFactor.code') }}
        </span>
        <input
          v-model="code"
          class="input-field"
          :autocomplete="method === 'backup' ? 'off' : 'one-time-code'"
          :inputmode="method === 'backup' ? 'text' : 'numeric'"
          :maxlength="method === 'backup' ? undefined : CODE_LENGTH"
          :pattern="method === 'backup' ? undefined : CODE_PATTERN"
          required
          spellcheck="false"
          type="text"
        />
      </label>

      <label class="flex items-center gap-2 text-xs text-muted">
        <input v-model="trustDevice" class="accent-accent" type="checkbox" />
        {{ $t('auth.twoFactor.trustDevice') }}
      </label>

      <p
        v-if="errorMessage"
        class="m-0 border border-danger/35 bg-danger/8 p-2.5 text-xs text-danger"
        role="alert"
      >
        {{ errorMessage }}
      </p>
      <p v-else-if="emailSent" class="m-0 text-xs text-muted" role="status">
        {{ $t('auth.twoFactor.emailSent') }}
      </p>

      <button class="btn-accent" :disabled="isPending" type="submit">
        {{ isPending ? $t('auth.twoFactor.submitPending') : $t('auth.twoFactor.submit') }}
      </button>
    </form>

    <div class="mt-4 flex flex-col gap-2">
      <button
        v-if="canUseEmailCode && method !== 'email'"
        class="btn-subtle w-full"
        :disabled="isPending"
        type="button"
        @click="onSendEmailCode"
      >
        {{
          sendOtp.status.value === 'pending'
            ? $t('auth.twoFactor.sendEmailPending')
            : $t('auth.twoFactor.sendEmail')
        }}
      </button>
      <button class="btn-link w-full text-center" type="button" @click="toggleBackupCode">
        {{
          method === 'backup'
            ? $t('auth.twoFactor.useAuthenticator')
            : $t('auth.twoFactor.useBackupCode')
        }}
      </button>
    </div>

    <NuxtLink class="btn-link mt-5 block w-full text-center" to="/login">
      {{ $t('auth.twoFactor.toSignIn') }}
    </NuxtLink>
  </section>
</template>

<script setup lang="ts">
/**
 * The second-factor challenge a password sign-in lands on when the account has two-factor
 * authentication turned on. The sign-in itself has already been accepted, but no session exists
 * yet: the server holds the pending sign-in in a short-lived cookie, and only a code it accepts
 * here turns that into a session.
 *
 * Three ways to answer, all against the server's own endpoints: the authenticator app's code, one
 * of the backup codes saved at enrollment, or — only when `/api/capabilities` reports that the
 * deployment delivers them — a code sent by mail. The code never leaves this page except in the
 * verification request, and is never logged or put in a URL.
 */
definePageMeta({ layout: 'auth' });

/** Authenticator and mailed codes are six digits; backup codes are longer and alphanumeric. */
const CODE_LENGTH = 6;
const CODE_PATTERN = '[0-9]*';

type Method = 'totp' | 'backup' | 'email';

const capabilities = await useAuthCapabilities();
const { localizeAuthError } = useAuthErrorMessage();
const { fetchSession } = useUserSession();

const verifyTotp = useAuthClientAction((client) => client.twoFactor.verifyTotp);
const verifyBackupCode = useAuthClientAction((client) => client.twoFactor.verifyBackupCode);
const verifyOtp = useAuthClientAction((client) => client.twoFactor.verifyOtp);
const sendOtp = useAuthClientAction((client) => client.twoFactor.sendOtp);

const method = ref<Method>('totp');
const code = ref('');
const trustDevice = ref(false);
const emailSent = ref(false);

const canUseEmailCode = computed(() => capabilities.value.twoFactorEmailOtp);

/** The verification the current method submits to; each keeps its own status and error. */
const verification = computed(() => {
  if (method.value === 'backup') return verifyBackupCode;
  if (method.value === 'email') return verifyOtp;
  return verifyTotp;
});

const subtitle = computed(() => {
  if (method.value === 'backup') return t('auth.twoFactor.backupSubtitle');
  if (method.value === 'email') return t('auth.twoFactor.emailSubtitle');
  return t('auth.twoFactor.subtitle');
});

const isPending = computed(
  () => verification.value.status.value === 'pending' || sendOtp.status.value === 'pending',
);
const errorMessage = computed(() => {
  const error = verification.value.error.value ?? sendOtp.error.value;
  return error ? localizeAuthError(error, 'auth.twoFactor.invalid') : undefined;
});

const { t } = useI18n();

function switchTo(next: Method): void {
  method.value = next;
  code.value = '';
}

function toggleBackupCode(): void {
  switchTo(method.value === 'backup' ? 'totp' : 'backup');
}

/**
 * Ask the server to mail a code, then collect it. The server decides whether the pending sign-in
 * may receive one; this page only offers the button when the deployment can deliver it.
 */
async function onSendEmailCode(): Promise<void> {
  await sendOtp.execute();
  if (sendOtp.status.value !== 'success') return;
  emailSent.value = true;
  switchTo('email');
}

/**
 * Verify the code. On success the server has just created the session, which the module's state
 * knows nothing about until it is fetched again, so the fetch is forced before leaving. On failure
 * the handle's error stays on the page and the visitor can try again, pick another method, or
 * go back to sign in.
 */
async function onSubmit(): Promise<void> {
  if (isPending.value) return;
  const action = verification.value;
  await action.execute({
    code: code.value,
    ...(trustDevice.value ? { trustDevice: true } : {}),
  });
  if (action.status.value !== 'success') return;
  await fetchSession({ force: true });
  await navigateTo('/');
}
</script>
