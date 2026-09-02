<template>
  <!-- `<meta name="color-scheme">` and `supported-color-schemes` are already emitted by Layout. -->
  <Layout body-class="bg-[#F8FBF8] dark:bg-[#070D09]" class="bg-[#F8FBF8] dark:bg-[#070D09]">
    <!-- The font stack sits here rather than on Layout: Layout's own `font-inter` would otherwise
         be emitted after it and win. Everything inside inherits. -->
    <Container
      class="p-6 font-[Inter,-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,Helvetica,Arial,sans-serif]"
    >
      <div
        class="border border-[#BFC7BF] border-solid bg-[#F1F5F1] p-8 dark:border-[#28302B] dark:bg-[#0D1310]"
      >
        <Header />

        <div class="pt-8">
          <slot />
        </div>

        <div class="pt-8">
          <Divider />
        </div>

        <div class="pt-5">
          <Footer>
            <slot name="footer" />
          </Footer>
        </div>
      </div>
    </Container>
  </Layout>
</template>

<script setup lang="ts">
import Divider from '../components/Divider.vue';
import Footer from '../components/Footer.vue';
import Header from '../components/Header.vue';

/**
 * Shell every message renders into: canvas wrapper, square hairline-bordered panel, brand lockup,
 * body, rule, footer. Light-first — every colour is written as an explicit hex utility that Maizzle
 * inlines, with a `dark:` counterpart that compiles into the head `<style>` as a
 * `prefers-color-scheme` rule (media queries cannot be inlined, so those classes survive by design).
 *
 * Hexes rather than a `Tailwind` block whose `@theme` names brand tokens: that block's compiled
 * `<style>` is inlined and dropped, but the class names it generated stay behind in the markup —
 * exactly what `mail.test.ts` guards against, since a client that drops stylesheets would then
 * render an unstyled message. Every template and component under `emails/` writes the same hexes.
 *
 * Components under `emails/components/` are imported by relative path: that directory is not one
 * Maizzle auto-registers, and `components.source` is not read at send time.
 *
 * API: `preheader` — the inbox preview line. Default slot is the message body; the `footer` slot
 * appends a note below the standard footer copy.
 */
const { preheader = 'A message from Code Zero.' } = defineProps<{ preheader?: string }>();

usePlaintext();
usePreheader(preheader);
</script>
