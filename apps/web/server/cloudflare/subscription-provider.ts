/**
 * Stands in for the two vendor packages that drive a local coding-agent CLI.
 *
 * `ai-sdk-provider-claude-code` and `ai-sdk-provider-codex-cli` start the vendor's executable on
 * the host and use the user's own login, which a Worker has neither of. `nuxt.config.ts` aliases
 * both here on Cloudflare so the bundle builds; a deployment that asks for a subscription model is
 * refused with this message rather than failing on a missing module, and an authentication check
 * on a failure that never reached a CLI answers no.
 */
function unavailable(): never {
  throw new Error('subscription model providers need a local CLI and are not available on Workers');
}

export const createClaudeCode = unavailable;
export const createCodexCli = unavailable;
export const isAuthenticationError = (): boolean => false;
