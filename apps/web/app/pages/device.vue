<template>
  <section class="panel w-full max-w-88 p-6">
    <h1 class="m-0 text-lg font-650 tracking-tight">
      {{ stage === 'confirm' ? $t('auth.device.confirmTitle') : $t('auth.device.title') }}
    </h1>

    <form v-if="stage === 'enter'" class="mt-4 flex flex-col gap-3" @submit.prevent="onVerify">
      <p class="m-0 text-xs text-muted">{{ $t('auth.device.subtitle') }}</p>

      <label class="flex flex-col gap-1.5">
        <span class="label-upper">{{ $t('auth.device.code') }}</span>
        <input
          v-model="userCode"
          autocapitalize="characters"
          autocomplete="one-time-code"
          class="input-field mono uppercase"
          required
          spellcheck="false"
          type="text"
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
        {{ isPending ? $t('auth.device.submitPending') : $t('auth.device.submit') }}
      </button>
    </form>

    <template v-else-if="stage === 'confirm'">
      <p class="m-0 mt-4 text-xs text-muted">{{ $t('auth.device.confirmPrompt') }}</p>

      <p class="mt-4 flex items-baseline justify-between gap-3">
        <span class="label-upper">{{ $t('auth.device.code') }}</span>
        <span class="mono text-sm text-ink tracking-[0.28em]">{{ userCode }}</span>
      </p>

      <p
        v-if="errorMessage"
        class="m-0 mt-3 border border-danger/35 bg-danger/8 p-2.5 text-xs text-danger"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <div class="mt-4 flex gap-2">
        <button class="btn-subtle flex-1" :disabled="isPending" type="button" @click="onDeny">
          {{ isPending ? $t('auth.device.denyPending') : $t('auth.device.deny') }}
        </button>
        <button class="btn-accent flex-1" :disabled="isPending" type="button" @click="onApprove">
          {{ isPending ? $t('auth.device.approvePending') : $t('auth.device.approve') }}
        </button>
      </div>
    </template>

    <template v-else>
      <p class="m-0 mt-4 text-xs" :class="stage === 'approved' ? 'text-muted' : 'text-ink'">
        {{ outcomeMessage }}
      </p>
      <NuxtLink class="btn-subtle mt-4 w-full" to="/">{{ $t('auth.invite.continue') }}</NuxtLink>
    </template>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * The verification page an RFC 8628 device flow sends a human to.
 *
 * The device — the `zero` CLI above all — never sees this page: it prints a short code and polls
 * `/api/auth/device/token` in the background. Everything that decides whether a session is minted
 * happens here, in a browser the operator is already signed into, which is the entire point of the
 * flow. `packages/auth`'s `DEVICE_VERIFICATION_PATH` is what points the CLI at this path, and it
 * is resolved against each deployment's own origin, so one CLI serves a cloud-managed deployment
 * and a self-hosted one without either being named in the client.
 *
 * Requires a session (see the route rule in `nuxt.config.ts`): approving is an act attributable to
 * an account, and the auth server binds the pending code to whoever loads it.
 */
definePageMeta({ layout: 'auth' });

const route = useRoute();
const { localizeAuthError } = useAuthErrorMessage();
const i18n = useI18n();

type Stage = 'enter' | 'confirm' | 'approved' | 'denied';

const stage = ref<Stage>('enter');
const isPending = ref(false);
const errorMessage = ref<string | undefined>();

/**
 * Prefilled from `?user_code=`, which is the `verification_uri_complete` the device may render as
 * a QR code. Treated as a convenience only: the code is still confirmed against the auth server
 * before anything is approved, so a crafted link can at most prefill a field.
 */
const userCode = ref(typeof route.query.user_code === 'string' ? route.query.user_code : '');

const outcomeMessage = computed(() =>
  stage.value === 'approved' ? i18n.t('auth.device.approved') : i18n.t('auth.device.denied'),
);

/**
 * Confirm the code exists and is still claimable before showing the approval step.
 *
 * Better Auth resolves API failures as `{ data, error }` rather than rejecting, so an expired or
 * unknown code has to be read off the resolved error as well as from the catch path.
 */
async function onVerify(): Promise<void> {
  if (isPending.value) return;
  const code = userCode.value.trim();
  if (!code) {
    errorMessage.value = i18n.t('auth.device.missingCode');
    return;
  }

  isPending.value = true;
  errorMessage.value = undefined;
  try {
    const client = useAuthClient();
    if (!client) {
      errorMessage.value = i18n.t('auth.device.invalid');
      return;
    }

    const { data, error } = await client.device({ query: { user_code: code } });
    if (error || data?.status !== 'pending') {
      errorMessage.value = localizeAuthError(error, 'auth.device.invalid');
      return;
    }

    userCode.value = code;
    stage.value = 'confirm';
  } catch {
    errorMessage.value = i18n.t('auth.device.invalid');
  } finally {
    isPending.value = false;
  }
}

async function onApprove(): Promise<void> {
  await decide('approve');
}

async function onDeny(): Promise<void> {
  await decide('deny');
}

/**
 * Record the operator's decision.
 *
 * Both outcomes are terminal for this page: the auth server consumes the pending record either
 * way, so there is nothing left to retry and the page stops offering the buttons.
 */
async function decide(outcome: 'approve' | 'deny'): Promise<void> {
  if (isPending.value) return;

  isPending.value = true;
  errorMessage.value = undefined;
  try {
    const client = useAuthClient();
    if (!client) {
      errorMessage.value = i18n.t('auth.device.invalid');
      return;
    }

    const { error } =
      outcome === 'approve'
        ? await client.device.approve({ userCode: userCode.value })
        : await client.device.deny({ userCode: userCode.value });

    if (error) {
      errorMessage.value = localizeAuthError(error, 'auth.device.invalid');
      return;
    }

    stage.value = outcome === 'approve' ? 'approved' : 'denied';
  } catch {
    errorMessage.value = i18n.t('auth.device.invalid');
  } finally {
    isPending.value = false;
  }
}
</script>
