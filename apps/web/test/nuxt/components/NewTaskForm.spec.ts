import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import NewTaskForm from '~~/modules/dashboard/components/NewTaskForm.vue';

describe('NewTaskForm', () => {
  it('submits the proactive shape, which carries no feedback', async () => {
    const wrapper = await mountSuspended(NewTaskForm);

    await wrapper.find('input[type="text"]').setValue('  /srv/checkouts/acme-app  ');
    await wrapper.find('form').trigger('submit');

    // `taskInput` rejects a feedback trigger without feedback and ignores it otherwise, so the
    // field is omitted rather than sent empty.
    expect(wrapper.emitted('submit')).toEqual([
      [{ repository: '/srv/checkouts/acme-app', mode: 'observe', trigger: 'proactive' }],
    ]);
  });

  it('asks for feedback only when the trigger is feedback, and sends it', async () => {
    const wrapper = await mountSuspended(NewTaskForm);

    expect(wrapper.find('textarea').exists()).toBe(false);

    const selects = wrapper.findAll('select');
    await selects[1]?.setValue('feedback');
    await wrapper.find('input[type="text"]').setValue('/srv/checkouts/acme-app');
    await wrapper.find('textarea').setValue('Possible null dereference in src/user.ts');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          repository: '/srv/checkouts/acme-app',
          mode: 'observe',
          trigger: 'feedback',
          feedback: 'Possible null dereference in src/user.ts',
        },
      ],
    ]);
  });

  it('defaults to the mode that cannot write to a checkout', async () => {
    const wrapper = await mountSuspended(NewTaskForm);

    expect(wrapper.findAll('select')[0]?.element.value).toBe('observe');
  });

  it('submits nothing more while one request is in flight', async () => {
    const wrapper = await mountSuspended(NewTaskForm, { props: { pending: true } });

    await wrapper.find('input[type="text"]').setValue('/srv/checkouts/acme-app');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('renders the failure the page reports', async () => {
    const wrapper = await mountSuspended(NewTaskForm, {
      props: { error: 'The task was not created.' },
    });

    expect(wrapper.text()).toContain('The task was not created.');
  });
});
