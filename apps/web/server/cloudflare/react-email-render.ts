/**
 * Stands in for `@react-email/render`, which `resend` loads only to render a React element.
 *
 * Code Zero sends HTML compiled from `packages/mail`, never a React tree, so that path is never
 * taken. A Worker bundle cannot leave an import unresolved, though, so `nuxt.config.ts` aliases the
 * package here on Cloudflare; if a React message were ever sent, it fails with this message instead
 * of a missing module.
 */
export function render(): never {
  throw new Error('rendering React emails is not supported; send the compiled HTML instead');
}
