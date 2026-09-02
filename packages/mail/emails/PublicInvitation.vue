<script setup>
import ActionButton from './components/ActionButton.vue';
import Callout from './components/Callout.vue';
import Base from './layouts/Base.vue';

const { inviterName, organizationName, shareUrl, maxUses, expiresAt } = useConfig();
</script>

<template>
  <Base preheader="Your public Code Zero invitation is ready to share.">
    <Text
      class="m-0 text-[10px] font-bold tracking-[0.16em] text-[#48574D] uppercase dark:text-[#95A29B]"
    >
      Public invitation
    </Text>

    <Heading
      level="1"
      class="mt-3 text-[20px] leading-[28px] font-bold tracking-[-0.01em] text-[#0B140E] dark:text-[#EFF3EE]"
    >
      Your invitation is ready to share
    </Heading>

    <Text class="mt-5 text-[15px] leading-[24px] text-[#0B140E] dark:text-[#EFF3EE]">
      Hello {{ inviterName }}, share this link with the people you want to invite
      <template v-if="organizationName">
        to <strong>{{ organizationName }}</strong>
      </template>
      on Code Zero.
    </Text>

    <div class="pt-6">
      <Callout>
        <Text
          class="m-0 text-[10px] font-bold tracking-[0.16em] text-[#48574D] uppercase dark:text-[#95A29B]"
        >
          Invitation limits
        </Text>
        <Text class="mt-2 text-[13px] leading-[21px] text-[#0B140E] dark:text-[#EFF3EE]">
          Uses: {{ maxUses }}<br />Expires: {{ expiresAt }}
        </Text>
      </Callout>
    </div>

    <div class="pt-7">
      <ActionButton :href="shareUrl">Open invitation</ActionButton>
    </div>

    <Text class="mt-7 text-[12px] leading-[20px] text-[#48574D] dark:text-[#95A29B]">
      Copy and share this address:
    </Text>

    <Text
      class="mt-2 font-[SFMono-Regular,Consolas,'Liberation_Mono',Menlo,monospace] text-[12px] leading-[20px] break-all text-[#48574D] dark:text-[#95A29B]"
    >
      {{ shareUrl }}
    </Text>
  </Base>
</template>
