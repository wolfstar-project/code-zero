<!--
  Brand lockup: the `AZ` monogram tile beside the wordmark.

  API: no props. Attributes (including `class`) fall through to the root table.
  Laid out with a table rather than flex because Outlook's Word engine ignores flexbox.
-->
<template>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="border-collapse">
    <tbody>
      <tr>
        <td
          width="32"
          height="32"
          align="center"
          valign="middle"
          class="h-[32px] w-[32px] border border-[#1C6A00] border-solid bg-[#E6EFE4] text-center align-middle dark:border-[#84E04F] dark:bg-[#111E0F]"
        >
          <!-- Decorative: the wordmark beside it already says the same thing in plaintext. -->
          <NotPlaintext>
            <span
              class="[font-family:SFMono-Regular,Consolas,'Liberation_Mono',Menlo,monospace] text-[11px] leading-none font-bold tracking-[0.06em] text-[#1C6A00] dark:text-[#84E04F]"
              >AZ</span
            >
          </NotPlaintext>
        </td>
        <td valign="middle" class="pl-3 align-middle">
          <span
            class="[font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,Helvetica,Arial,sans-serif] text-[13px] leading-none font-bold tracking-[0.18em] text-[#0B140E] uppercase dark:text-[#EFF3EE]"
            >Code Zero</span
          >
        </td>
      </tr>
    </tbody>
  </table>
</template>
