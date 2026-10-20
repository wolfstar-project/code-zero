/** The query key `@onmax/nuxt-better-auth` carries a protected page under when it sends a visitor to sign in. */
export const REDIRECT_QUERY_KEY = 'redirect';

/** Pages a finished sign-in must not return to: they would only start another one. */
const SIGN_IN_PATHS = new Set(['/login', '/signup', '/two-factor']);

/** Where the path of a redirect ends and its query or fragment begins. */
const PATH_END = /[?#]/u;

/**
 * The page a sign-in should return to, if `value` names one on this app, else `undefined`.
 *
 * The value comes from the address bar, so anyone can write it into a link. Only a path on this
 * origin is accepted: it must start with one `/`, and `//host` or `/\host` — which browsers read
 * as another origin — are refused, as is anything carrying a control character. The sign-in pages
 * themselves are refused too, so a challenge cannot loop back into itself.
 */
export function safeLocalRedirect(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string' || !candidate.startsWith('/')) return undefined;
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return undefined;
  if (hasControlCharacter(candidate)) return undefined;
  const path = candidate.split(PATH_END, 1)[0] ?? '';
  if (SIGN_IN_PATHS.has(path)) return undefined;
  return candidate;
}

/** Whether `value` holds a C0 control character or DEL, which no address a link writes contains. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
