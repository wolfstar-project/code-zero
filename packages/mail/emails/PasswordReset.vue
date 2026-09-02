<script setup>
import ActionButton from './components/ActionButton.vue';
import Base from './layouts/Base.vue';

const { name, resetUrl } = useConfig();
</script>

<template>
  <Base preheader="Choose a new password for your Code Zero account.">
    <Text
      class="m-0 text-[10px] font-bold tracking-[0.16em] text-[#48574D] uppercase dark:text-[#95A29B]"
    >
      Security
    </Text>

    <Heading
      level="1"
      class="mt-3 text-[20px] leading-[28px] font-bold tracking-[-0.01em] text-[#0B140E] dark:text-[#EFF3EE]"
    >
      Reset your password
    </Heading>

    <Text class="mt-5 text-[15px] leading-[24px] text-[#0B140E] dark:text-[#EFF3EE]">
      Hello {{ name }},
    </Text>

    <Text class="mt-3 text-[15px] leading-[24px] text-[#0B140E] dark:text-[#EFF3EE]">
      Use the link below to choose a new password. If you did not request a reset, your password
      remains unchanged.
    </Text>

    <div class="pt-7">
      <ActionButton :href="resetUrl">Reset password</ActionButton>
    </div>

    <Text class="mt-7 text-[12px] leading-[20px] text-[#48574D] dark:text-[#95A29B]">
      If the button does not work, paste this address into your browser:
    </Text>

    <Text
      class="mt-2 font-[SFMono-Regular,Consolas,'Liberation_Mono',Menlo,monospace] text-[12px] leading-[20px] break-all text-[#48574D] dark:text-[#95A29B]"
    >
      {{ resetUrl }}
    </Text>
  </Base>
</template>
