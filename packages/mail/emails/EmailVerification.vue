<script setup>
import ActionButton from './components/ActionButton.vue';
import Base from './layouts/Base.vue';

const { name, verifyUrl } = useConfig();
</script>

<template>
  <Base preheader="Confirm your email address to finish setting up your Code Zero account.">
    <Text
      class="m-0 text-[10px] font-bold tracking-[0.16em] text-[#48574D] uppercase dark:text-[#95A29B]"
    >
      Account
    </Text>

    <Heading
      level="1"
      class="mt-3 text-[20px] leading-[28px] font-bold tracking-[-0.01em] text-[#0B140E] dark:text-[#EFF3EE]"
    >
      Confirm your email address
    </Heading>

    <Text class="mt-5 text-[15px] leading-[24px] text-[#0B140E] dark:text-[#EFF3EE]">
      Hello {{ name }},
    </Text>

    <Text class="mt-3 text-[15px] leading-[24px] text-[#0B140E] dark:text-[#EFF3EE]">
      Confirm this address to finish setting up your Code Zero account.
    </Text>

    <div class="pt-7">
      <ActionButton :href="verifyUrl">Confirm email address</ActionButton>
    </div>

    <Text class="mt-7 text-[12px] leading-[20px] text-[#48574D] dark:text-[#95A29B]">
      If the button does not work, paste this address into your browser:
    </Text>

    <Text
      class="mt-2 font-[SFMono-Regular,Consolas,'Liberation_Mono',Menlo,monospace] text-[12px] leading-[20px] break-all text-[#48574D] dark:text-[#95A29B]"
    >
      {{ verifyUrl }}
    </Text>
  </Base>
</template>
