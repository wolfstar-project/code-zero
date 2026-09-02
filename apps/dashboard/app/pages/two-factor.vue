<template>
  <section class="panel w-full max-w-120 p-6">
    <h1 class="m-0 text-lg font-650 tracking-tight">{{ $t('auth.twoFactor.title') }}</h1>

    <p v-if="!ready" class="mb-0 mt-4 text-xs text-muted">
      {{ $t('auth.twoFactor.loading') }}
    </p>

    <template v-else-if="!loggedIn">
      <p class="mb-0 mt-1 text-xs text-muted">{{ $t('auth.twoFactor.challengeSubtitle') }}</p>

      <div class="mt-5 grid grid-cols-2 gap-2" role="group">
        <button
          v-for="factor in factors"
          :key="factor"
          class="focus-ring h-9 border text-xs font-650 transition"
          :class="
            challengeFactor === factor
              ? 'border-accent bg-accent/8 text-ink'
              : 'border-line bg-raised text-muted hover:text-ink'
          "
          :data-factor="factor"
          type="button"
          @click="challengeFactor = factor"
        >
          {{
            factor === 'totp'
              ? $t('auth.twoFactor.factor.totp')
              : $t('auth.twoFactor.factor.backup')
          }}
        </button>
      </div>

      <form data-mode="challenge" class="mt-4 flex flex-col gap-3" @submit.prevent="onChallenge">
        <label class="flex flex-col gap-1.5">
          <span class="label-upper">
            {{
              challengeFactor === 'totp'
                ? $t('auth.twoFactor.code')
                : $t('auth.twoFactor.backupCode')
            }}
          </span>
          <input
            v-model="code"
            autocomplete="one-time-code"
            class="input-field mono"
            :inputmode="challengeFactor === 'totp' ? 'numeric' : 'text'"
            required
            spellcheck="false"
            type="text"
          />
        </label>

        <label class="flex items-center gap-2 text-xs text-muted">
          <input v-model="trustDevice" type="checkbox" />
          {{ $t('auth.twoFactor.trustDevice') }}
        </label>

        <TwoFactorError :message="errorMessage" />

        <button class="btn-accent" :disabled="isPending" type="submit">
          {{ isPending ? $t('auth.twoFactor.verifyPending') : $t('auth.twoFactor.verify') }}
        </button>
      </form>
    </template>

    <template v-else-if="twoFactorEnabled">
      <p class="mb-0 mt-1 text-xs text-muted">{{ $t('auth.twoFactor.enabled') }}</p>

      <form data-mode="disable" class="mt-5 flex flex-col gap-3" @submit.prevent="onDisable">
        <label class="flex flex-col gap-1.5">
          <span class="label-upper">{{ $t('auth.login.password') }}</span>
          <input
            v-model="password"
            autocomplete="current-password"
            class="input-field"
            required
            type="password"
          />
        </label>

        <TwoFactorError :message="errorMessage" />

        <button class="btn-subtle" :disabled="isPending" type="submit">
          {{ isPending ? $t('auth.twoFactor.disablePending') : $t('auth.twoFactor.disable') }}
        </button>
      </form>
    </template>

    <template v-else-if="totpUri">
      <p class="mb-0 mt-1 text-xs text-muted">{{ $t('auth.twoFactor.scan') }}</p>

      <div class="mt-5 grid gap-5 md:grid-cols-[12rem_1fr]">
        <div class="grid place-items-center border border-line bg-white p-3">
          <img v-if="qrImage" class="h-44 w-44" :src="qrImage" :alt="$t('auth.twoFactor.qrAlt')" />
          <code v-else class="break-all text-3xs text-canvas">{{ totpUri }}</code>
        </div>

        <div>
          <h2 class="m-0 text-sm font-650">{{ $t('auth.twoFactor.backupCodesTitle') }}</h2>
          <p class="mb-3 mt-1 text-xs text-muted">{{ $t('auth.twoFactor.backupCodesHint') }}</p>
          <ul class="m-0 grid grid-cols-2 gap-1 border border-line bg-raised p-3 list-none">
            <li v-for="backupCode in backupCodes" :key="backupCode" class="mono text-xs">
              {{ backupCode }}
            </li>
          </ul>
        </div>
      </div>

      <form data-mode="confirm" class="mt-5 flex flex-col gap-3" @submit.prevent="onConfirm">
        <label class="flex flex-col gap-1.5">
          <span class="label-upper">{{ $t('auth.twoFactor.confirmCode') }}</span>
          <input
            v-model="code"
            autocomplete="one-time-code"
            class="input-field mono"
            inputmode="numeric"
            required
            spellcheck="false"
            type="text"
          />
        </label>

        <TwoFactorError :message="errorMessage" />

        <button class="btn-accent" :disabled="isPending" type="submit">
          {{ isPending ? $t('auth.twoFactor.confirmPending') : $t('auth.twoFactor.confirm') }}
        </button>
      </form>
    </template>

    <template v-else>
      <p class="mb-0 mt-1 text-xs text-muted">{{ $t('auth.twoFactor.disabled') }}</p>

      <form data-mode="enable" class="mt-5 flex flex-col gap-3" @submit.prevent="onEnable">
        <label class="flex flex-col gap-1.5">
          <span class="label-upper">{{ $t('auth.login.password') }}</span>
          <input
            v-model="password"
            autocomplete="current-password"
            class="input-field"
            required
            type="password"
          />
        </label>

        <TwoFactorError :message="errorMessage" />

        <button class="btn-accent" :disabled="isPending" type="submit">
          {{ isPending ? $t('auth.twoFactor.enablePending') : $t('auth.twoFactor.enable') }}
        </button>
      </form>
    </template>
  </section>
</template>

<script setup lang="ts">
import QRCode from 'qrcode';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'auth' });

const { user, loggedIn, ready, fetchSession } = useUserSession();
const i18n = useI18n();

const factors = ['totp', 'backup'] as const;
type ChallengeFactor = (typeof factors)[number];

const challengeFactor = ref<ChallengeFactor>('totp');
const trustDevice = ref(true);
const password = ref('');
const code = ref('');
const totpUri = ref('');
const qrImage = ref('');
const backupCodes = ref<string[]>([]);
const isPending = ref(false);
const errorMessage = ref<string>();

const twoFactorEnabled = computed(() =>
  Boolean(user.value && 'twoFactorEnabled' in user.value && user.value.twoFactorEnabled),
);

function authClient() {
  const client = useAuthClient();
  if (!client) throw new Error('auth client unavailable');
  return client;
}

function responseFailed(result: { error?: unknown }): boolean {
  if (!result.error) return false;
  errorMessage.value = i18n.t('auth.twoFactor.error');
  return true;
}

async function onChallenge(): Promise<void> {
  if (isPending.value) return;
  isPending.value = true;
  errorMessage.value = undefined;
  try {
    const value = code.value.trim();
    const result =
      challengeFactor.value === 'totp'
        ? await authClient().twoFactor.verifyTotp({ code: value, trustDevice: trustDevice.value })
        : await authClient().twoFactor.verifyBackupCode({
            code: value,
            trustDevice: trustDevice.value,
          });
    if (!responseFailed(result)) await navigateTo('/');
  } catch {
    errorMessage.value = i18n.t('auth.twoFactor.error');
  } finally {
    isPending.value = false;
  }
}

async function onEnable(): Promise<void> {
  if (isPending.value) return;
  isPending.value = true;
  errorMessage.value = undefined;
  try {
    const result = await authClient().twoFactor.enable({ password: password.value });
    if (responseFailed(result) || !result.data) return;

    totpUri.value = result.data.totpURI;
    backupCodes.value = result.data.backupCodes;
    password.value = '';
    qrImage.value = await QRCode.toDataURL(result.data.totpURI, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 352,
    });
  } catch {
    errorMessage.value = i18n.t('auth.twoFactor.error');
  } finally {
    isPending.value = false;
  }
}

async function onConfirm(): Promise<void> {
  if (isPending.value) return;
  isPending.value = true;
  errorMessage.value = undefined;
  try {
    const result = await authClient().twoFactor.verifyTotp({ code: code.value.trim() });
    if (responseFailed(result)) return;
    await fetchSession({ force: true });
    totpUri.value = '';
    qrImage.value = '';
    backupCodes.value = [];
    code.value = '';
  } catch {
    errorMessage.value = i18n.t('auth.twoFactor.error');
  } finally {
    isPending.value = false;
  }
}

async function onDisable(): Promise<void> {
  if (isPending.value) return;
  isPending.value = true;
  errorMessage.value = undefined;
  try {
    const result = await authClient().twoFactor.disable({ password: password.value });
    if (responseFailed(result)) return;
    password.value = '';
    await fetchSession({ force: true });
  } catch {
    errorMessage.value = i18n.t('auth.twoFactor.error');
  } finally {
    isPending.value = false;
  }
}
</script>
