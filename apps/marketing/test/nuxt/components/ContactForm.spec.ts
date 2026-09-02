import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ContactForm from '~~/modules/contact/components/Form.vue';

const MAILTO_PATTERN = /^mailto:hello@code-zero\.dev\?/u;

describe('ContactForm', () => {
  const originalHref = window.location.href;

  beforeEach(() => {
    // jsdom/happy-dom throws on a real navigation; the component only ever sets `href`, so the
    // stub only needs that property rather than every field of the real `Location` instance.
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: originalHref },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { writable: true, value: window.location });
  });

  it('blocks submission until every field is filled in', async () => {
    const wrapper = await mountSuspended(ContactForm);

    await wrapper.get('form').trigger('submit');

    expect(wrapper.get('[role="alert"]').text()).toBe('Fill in every field before sending.');
    expect(window.location.href).toBe(originalHref);
  });

  it('builds a mailto: link from the filled-in fields and navigates to it', async () => {
    const wrapper = await mountSuspended(ContactForm);

    await wrapper.get('input[name="name"]').setValue('Jane Doe');
    await wrapper.get('input[name="email"]').setValue('jane@example.com');
    await wrapper.get('textarea[name="message"]').setValue('Tell me about the Team tier.');
    await wrapper.get('form').trigger('submit');

    expect(window.location.href).toMatch(MAILTO_PATTERN);
    expect(window.location.href).toContain(encodeURIComponent('Message from Jane Doe'));
    expect(window.location.href).toContain(encodeURIComponent('Tell me about the Team tier.'));
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
