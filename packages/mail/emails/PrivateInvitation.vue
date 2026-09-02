<script setup>
import ActionButton from './components/ActionButton.vue';
import Base from './layouts/Base.vue';

const { name, inviterName, organizationName, acceptUrl } = useConfig();
</script>

<template>
  <Base preheader="You have been invited to Code Zero.">
    <Text
      class="m-0 text-[10px] font-bold tracking-[0.16em] text-[#48574D] uppercase dark:text-[#95A29B]"
    >
      Invitation
    </Text>

    <Heading
      level="1"
      class="mt-3 text-[20px] leading-[28px] font-bold tracking-[-0.01em] text-[#0B140E] dark:text-[#EFF3EE]"
    >
      You have been invited
    </Heading>

    <!-- The inviter is not always asked for the invitee's name, and an invitation can grant an
         app-wide role rather than a membership, so both halves render away rather than printing an
         empty value. -->
    <Text class="mt-5 text-[15px] leading-[24px] text-[#0B140E] dark:text-[#EFF3EE]">
      <template v-if="name">Hello {{ name }},</template>
      <template v-else>Hello,</template>
    </Text>

    <Text class="mt-3 text-[15px] leading-[24px] text-[#0B140E] dark:text-[#EFF3EE]">
      <template v-if="organizationName">
        {{ inviterName }} invited you to join <strong>{{ organizationName }}</strong> on Code Zero.
      </template>
      <template v-else> {{ inviterName }} invited you to create an account on Code Zero. </template>
    </Text>

    <div class="pt-7">
      <ActionButton :href="acceptUrl">Accept invitation</ActionButton>
    </div>

    <Text class="mt-7 text-[12px] leading-[20px] text-[#48574D] dark:text-[#95A29B]">
      This link is tied to your email address and can be used once. If you were not expecting it,
      you can ignore this message.
    </Text>

    <Text class="mt-3 text-[12px] leading-[20px] text-[#48574D] dark:text-[#95A29B]">
      If the button does not work, paste this address into your browser:
    </Text>

    <Text
      class="mt-2 font-[SFMono-Regular,Consolas,'Liberation_Mono',Menlo,monospace] text-[12px] leading-[20px] break-all text-[#48574D] dark:text-[#95A29B]"
    >
      {{ acceptUrl }}
    </Text>
  </Base>
</template>
