/**
 * Which sign-in and account capabilities this deployment serves, for pages to render from.
 *
 * Read per request from the same environment `server/auth.config.ts` builds Better Auth from, so
 * a policy change shows on the sign-in page without a rebuild. Public on purpose — the sign-in page
 * needs it before anyone is signed in — which is safe because `authCapabilities` publishes plain
 * booleans only: no credential, origin, or limit.
 */
export default defineEventHandler((event) => {
  // Short and private: a proxy must not pin one deployment's policy for another, and the page
  // should see a change within a minute.
  setResponseHeader(event, 'cache-control', 'private, max-age=60');
  return deploymentAuthCapabilities();
});
