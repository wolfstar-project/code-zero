export {
  parseInboundForwards,
  routeInboundMail,
  type InboundDecision,
  type InboundForwards,
} from './inbound.js';
export {
  createMailer,
  sendEmail,
  type MailerOptions,
  type SendEmail,
  type SendEmailOptions,
} from './mail.js';
export {
  createCloudflareProvider,
  createConsoleProvider,
  createResendProvider,
  createSmtpProvider,
  MAIL_PROVIDER_NAMES,
  mailProviderFromEnvironment,
  mailProviderNameFromEnvironment,
  type CloudflareEmailBinding,
  type CloudflareProviderOptions,
  type MailProvider,
  type MailProviderBindings,
  type MailProviderName,
  type OutgoingMail,
  type ResendProviderOptions,
  type SmtpProviderOptions,
} from './provider/index.js';
export { mailTemplates, type MailTemplateContext, type MailTemplateId } from './util/templates.js';
