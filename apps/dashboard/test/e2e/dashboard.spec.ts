import { expect, mockAuthSession, test } from './test-utils.js';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthSession(page, true);
  });

  test('renders the frontend dashboard without runtime or hydration errors', async ({
    page,
    goto,
    hydrationErrors,
    consoleErrors,
  }) => {
    const response = await goto('/', { waitUntil: 'networkidle' });

    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Control Plane', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No tasks recorded', level: 3 })).toBeVisible();
    expect(hydrationErrors).toHaveLength(0);
    expect(consoleErrors).toHaveLength(0);
  });

  test('switches between persistent light and dark themes', async ({
    page,
    goto,
    hydrationErrors,
    consoleErrors,
  }) => {
    await page.addInitScript({
      content:
        "if (!localStorage.getItem('code-zero-color-mode')) localStorage.setItem('code-zero-color-mode', 'dark')",
    });
    await goto('/', { waitUntil: 'networkidle' });

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(hydrationErrors).toHaveLength(0);
    expect(consoleErrors).toHaveLength(0);
  });

  test('translates the interface when the locale changes', async ({ page, goto }) => {
    await goto('/', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'No tasks recorded', level: 3 })).toBeVisible();

    await page.getByRole('combobox', { name: 'Language' }).selectOption('it');

    await expect(
      page.getByRole('heading', { name: 'Nessun task registrato', level: 3 }),
    ).toBeVisible();
  });
});
