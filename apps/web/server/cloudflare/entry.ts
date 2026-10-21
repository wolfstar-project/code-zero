import worker from 'nitropack/presets/cloudflare/runtime/cloudflare-module';

import { settleInboundMail, stringVariable, type InboundMessage } from '../utils/inbound-mail.js';

/**
 * The Worker's entry on Cloudflare: the preset's own, with `email` answered here.
 *
 * Email Routing needs the message settled (forwarded or refused) before the handler returns.
 * The preset's `email` hands the message to a hook under `waitUntil` and returns immediately, so
 * the event ends first and a forward that was still in flight is cut off. Awaiting the decision
 * here keeps the event open until the message is settled. Everything else the Worker does still
 * goes through the preset.
 *
 * Which aliases forward where comes from `MAIL_INBOUND_FORWARDS` in the Worker's environment,
 * read on each message.
 */
export default {
  ...worker,
  email: (message: InboundMessage, env: unknown) =>
    settleInboundMail(message, stringVariable(env, 'MAIL_INBOUND_FORWARDS')),
};
