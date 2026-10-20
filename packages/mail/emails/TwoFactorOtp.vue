<script setup>
import Callout from './components/Callout.vue';
import Base from './layouts/Base.vue';

const { name, code } = useConfig();
</script>

<template>
  <Base preheader="Your Code Zero verification code.">
    <Text
      class="m-0 text-[10px] font-bold tracking-[0.16em] text-[#48574D] uppercase dark:text-[#95A29B]"
    >
      Security
    </Text>

    <Heading
      level="1"
      class="mt-3 text-[20px] leading-[28px] font-bold tracking-[-0.01em] text-[#0B140E] dark:text-[#EFF3EE]"
    >
      Your verification code
    </Heading>

    <Text class="mt-5 text-[15px] leading-[24px] text-[#0B140E] dark:text-[#EFF3EE]">
      Hello {{ name }},
    </Text>

    <Text class="mt-3 text-[15px] leading-[24px] text-[#0B140E] dark:text-[#EFF3EE]">
      Enter this code to finish signing in to Code Zero. It works once and expires shortly.
    </Text>

    <!-- The code is the credential: it is printed once, large enough to copy by eye, and is
         never part of a link, so nothing in this message signs anyone in on its own. -->
    <div class="pt-7">
      <Callout>
        <Text
          class="m-0 font-[SFMono-Regular,Consolas,'Liberation_Mono',Menlo,monospace] text-[28px] leading-[36px] font-bold tracking-[0.24em] text-[#0B140E] dark:text-[#EFF3EE]"
        >
          {{ code }}
        </Text>
      </Callout>
    </div>

    <Text class="mt-7 text-[12px] leading-[20px] text-[#48574D] dark:text-[#95A29B]">
      If you did not try to sign in, someone else knows your password. Change it, and do not share
      this code with anyone: Code Zero will never ask for it.
    </Text>
  </Base>
</template>
