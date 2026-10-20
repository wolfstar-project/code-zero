import { expect, test as base } from '@nuxt/test-utils/playwright';
import type { ConsoleMessage, Page } from '@playwright/test';

/**
 * Fixed credentials for the e2e suite's own throwaway account.
 *
 * The Playwright preview server (`start:playwright:webserver`) runs `server/auth.config.ts` with
 * `AUTH_E2E_MEMORY=true`, which swaps the Postgres adapter for an in-memory one and enables
 * signup, so the suite can create and sign in this account itself without a live database.
 */
const TEST_USER = {
  email: 'e2e-operator@example.test',
  password: 'e2e-test-password-not-a-secret',
  name: 'Operator',
};

/**
 * Establish (or clear) a real Better Auth session for the current browser context.
 *
 * Session resolution now happens server-side during SSR, from the request cookie, so a
 * browser-network interception (as when the adapter lived on a separate, unmocked origin) can no
 * longer fake a signed-in visitor: the server would still render the signed-out page before any
 * client-side mock could apply. Signing up (or, once the account already exists from an earlier
 * test against the same in-memory server, signing in) through the real `/api/auth/**` endpoints
 * is what makes the session cookie real. `page.context().request` shares its cookie jar with
 * `page`, so the cookie set by these calls is what a following `goto` sends.
 */
export async function mockAuthSession(page: Page, signedIn: boolean): Promise<void> {
  if (!signedIn) {
    await page.context().clearCookies();
    return;
  }

  const api = page.context().request;
  const signUp = await api.post('/api/auth/sign-up/email', {
    data: TEST_USER,
    failOnStatusCode: false,
  });
  if (signUp.ok()) return;

  const signIn = await api.post('/api/auth/sign-in/email', {
    data: { email: TEST_USER.email, password: TEST_USER.password },
    failOnStatusCode: false,
  });
  if (!signIn.ok())
    throw new Error(
      `Could not establish an e2e session: sign-up ${signUp.status()}, sign-in ${signIn.status()}`,
    );
}

const hydrationMismatchPatterns = [
  'Hydration completed but contains mismatches',
  'Hydration text content mismatch',
  'Hydration node mismatch',
  'Hydration children mismatch',
  'Hydration attribute mismatch',
  'Hydration class mismatch',
  'Hydration style mismatch',
];

function isHydrationMismatch(message: ConsoleMessage): boolean {
  return hydrationMismatchPatterns.some((pattern) => message.text().includes(pattern));
}

function isApplicationConsoleError(message: ConsoleMessage): boolean {
  return (
    message.type() === 'error' ||
    (message.type() === 'warning' && message.text().includes('[nuxt]'))
  );
}

export const test = base.extend<{ hydrationErrors: string[]; consoleErrors: string[] }>({
  hydrationErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (isHydrationMismatch(message)) errors.push(message.text());
    });
    await use(errors);
  },
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (isApplicationConsoleError(message)) errors.push(message.text());
    });
    await use(errors);
  },
});

export { expect };
