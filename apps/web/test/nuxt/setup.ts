/**
 * Stand in for the in-process `/api/auth/**` route (`server/auth.config.ts`), mirroring
 * `mockAuthSession` in `test/e2e/test-utils.ts`.
 *
 * That route owns a database and a signing secret, so component tests never boot it. This fetch
 * stub resolves every `/api/auth/**` request as signed out, keeping the suite fully off the
 * network regardless of origin. Specs that need a signed-in session mock `useUserSession` instead.
 */
const realFetch = globalThis.fetch;

// Parameter types are contextually inferred from `globalThis.fetch`: the plain `tsc` pass over
// test/** has no DOM lib, so names like `RequestInfo` cannot be referenced directly.
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;

  if (new URL(url, 'http://localhost').pathname.startsWith('/api/auth/')) {
    return Promise.resolve(
      new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }

  return realFetch(input, init);
};
