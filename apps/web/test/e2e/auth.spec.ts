import { expect, mockAuthSession, test } from './test-utils.js';

const LOGIN_URL = /\/login/;
const DASHBOARD_URL = /\/$|\/\?/;

test.describe('Authentication', () => {
  test('sends an unauthenticated visitor to the login page', async ({ page, goto }) => {
    await mockAuthSession(page, false);

    await goto('/', { waitUntil: 'networkidle' });

    await expect(page).toHaveURL(LOGIN_URL);
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  });

  test('keeps an authenticated visitor off the login page', async ({ page, goto }) => {
    await mockAuthSession(page, true);

    await goto('/login', { waitUntil: 'networkidle' });

    await expect(page).toHaveURL(DASHBOARD_URL);
    await expect(page.getByRole('heading', { name: 'Control Plane', level: 1 })).toBeVisible();
  });

  test('shows the signed-in operator and a sign-out control', async ({ page, goto }) => {
    await mockAuthSession(page, true);

    await goto('/', { waitUntil: 'networkidle' });

    await expect(page.getByText('Operator')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('hides disabled sign-in methods on the login page', async ({ page, goto }) => {
    await mockAuthSession(page, false);

    await goto('/login', { waitUntil: 'networkidle' });

    // Signup and GitHub OAuth are off by default in `defaultAuthConfig`, so neither affordance
    // should be offered.
    await expect(page.getByRole('button', { name: 'Create account' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
