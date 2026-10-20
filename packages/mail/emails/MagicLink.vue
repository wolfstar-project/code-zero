<script setup>
import ActionButton from './components/ActionButton.vue';
import Base from './layouts/Base.vue';

const { signInUrl } = useConfig();
</script>

<template>
  <Base preheader="Use this link to sign in to Code Zero.">
    <Text
      class="m-0 text-[10px] font-bold tracking-[0.16em] text-[#48574D] uppercase dark:text-[#95A29B]"
    >
      Sign in
    </Text>

    <Heading
      level="1"
      class="mt-3 text-[20px] leading-[28px] font-bold tracking-[-0.01em] text-[#0B140E] dark:text-[#EFF3EE]"
    >
      Sign in to Code Zero
    </Heading>

    <!-- No greeting by name: a magic link is requested by typing an address, and the account it
         belongs to is not looked up before the message is sent. -->
    <Text class="mt-5 text-[15px] leading-[24px] text-[#0B140E] dark:text-[#EFF3EE]">
      Use the link below to sign in. It works once and expires shortly. If you did not request it,
      you can ignore this message: nobody can sign in without it.
    </Text>

    <div class="pt-7">
      <ActionButton :href="signInUrl">Sign in</ActionButton>
    </div>

    <Text class="mt-7 text-[12px] leading-[20px] text-[#48574D] dark:text-[#95A29B]">
      If the button does not work, paste this address into your browser:
    </Text>

    <Text
      class="mt-2 font-[SFMono-Regular,Consolas,'Liberation_Mono',Menlo,monospace] text-[12px] leading-[20px] break-all text-[#48574D] dark:text-[#95A29B]"
    >
      {{ signInUrl }}
    </Text>
  </Base>
</template>
